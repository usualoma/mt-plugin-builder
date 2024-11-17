#!/usr/bin/env node

import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import archiver from "archiver";
import * as yaml from "js-yaml";
import * as esbuild from "esbuild";
import type { PluginConfig } from "./index";

async function loadConfig(): Promise<PluginConfig> {
  const configPath = path.resolve(process.cwd(), "mt-plugin.config.ts");

  if (!fs.existsSync(configPath)) {
    throw new Error("Configuration file mt-plugin.config.ts not found.");
  }

  try {
    // esbuildでトランスパイル
    const result = await esbuild.build({
      entryPoints: [configPath],
      write: false,
      format: "cjs",
      platform: "node",
      bundle: true,
      target: "node18",
    });

    const { text } = result.outputFiles[0];

    // 評価して設定を取得
    const mod = require("module");
    const configModule = new mod.Module(configPath);
    configModule.paths = mod.Module._nodeModulePaths(path.dirname(configPath));
    configModule._compile(text, configPath);

    if (!configModule.exports.default) {
      throw new Error("No default export found in configuration file.");
    }

    return configModule.exports.default as PluginConfig;
  } catch (error) {
    throw new Error(`Failed to load configuration file: ${error}`);
  }
}

async function createConfigYaml(config: PluginConfig, tmpDir: string) {
  const phpFiles: Record<string, string> = {};
  const exportedConfig: PluginConfig & {
    applications?: {
      cms?: {
        methods?: Record<string, string>;
      };
    };
  } = (
    [
      "id",
      "name",
      "version",
      "author_link",
      "author_name",
      "description",
    ] as const
  ).reduce((acc, key) => {
    if (config[key] !== undefined) {
      acc[key] = config[key];
    }
    return acc;
  }, {} as PluginConfig);

  exportedConfig.callbacks ??= {};
  for (const [key, value] of Object.entries(config.callbacks ?? {})) {
    if (!value) {
      continue;
    }

    const packageName = key.match(/^(MT::[^:]+)/)?.[1];
    if (packageName && /^MT::[^\:]+::(pre_|post_)/i.test(key)) {
      // inline perl code
      exportedConfig.callbacks[key] = `sub {
        require MT::Util;

        my ( $cb, $obj, $orig ) = @_;
        my $data = {
          'package' => '${packageName}',
          object => $obj->get_values(),
          ($orig ? (original => $orig->get_values()) : ()),
        };
        my $ua = MT->new_ua; # LWP::UserAgent

        my $res = $ua->post(
          '${value}',
          Content_Type => 'application/json',
          Content => Encode::encode('utf8', MT::Util::to_json($data)),
        );

        die $res->status_line if $res->is_error;

        if ($res->header('Content-Type') =~ /application\\/json/) {
          my $result = MT::Util::from_json($res->decoded_content);
          if ($result->{object}) {
            $obj->set_values($result->{object});
          }
        }

        1;
      }`;
      continue;
    }

    throw new Error(`Unknown callback function: ${key}`);
  }

  if (config.script) {
    exportedConfig.callbacks["MT::App::CMS::template_param.header"] = `sub {
      my ( $cb, $app, $param, $tmpl ) = @_;
      require File::Basename;
 
      my $plugin      = MT->component( "${config.id}" );
      my $static      = $app->static_path;
      my $plugin_name = File::Basename::basename( $plugin->{full_path} );
      my $static_path = "\${static}plugins/$plugin_name";
      my $token = $tmpl->createTextNode(
        "<script src=\\\"$static_path/${config.script}?v=${config.version}\\\" type=\\\"module\\\"></script>"
      );
      my $js_includes = $tmpl->getElementsByName("js_include")
        or return;
      my $before = $js_includes->[0];
      $tmpl->insertBefore( $token, $before ); 
    }`;

    if (config.user_token_secret) {
      exportedConfig.applications = {
        cms: {
          methods: {
            [`mt_plugin_${config.id}_user_token`]: `sub {
      my $app = shift;

      require MIME::Base64;
      require MIME::Base64;
      require MT::Util::Digest::SHA;
  
      my $user_token_secret = '${config.user_token_secret}';
      my $user = $app->user;
      my $iat = int(time());
      my $user_data = {
        'id' => $user->id,
        'name' => $user->name,
        'nickname' => $user->nickname,
        'sub' => $user->id,
        'iat' => $iat,
        'exp' => $iat + 600,
      };

      my $user_token_header = MT::Util::to_json({
        alg => 'HS256',
        typ => 'JWT'
      });
      my $user_token_payload = MT::Util::to_json($user_data);

      my $base64url_encode = sub {
        my $data = shift;
        my $encoded = MIME::Base64::encode_base64($data, '');
        $encoded =~ tr{+/}{-_};
        $encoded =~ s/=+\\z//;
        return $encoded;
      };

      my $encoded_header = $base64url_encode->(Encode::encode_utf8($user_token_header));
      my $encoded_payload = $base64url_encode->(Encode::encode_utf8($user_token_payload));

      my $signature_input = Encode::encode_utf8("$encoded_header.$encoded_payload");
      my $signature = MT::Util::Digest::SHA::hmac_sha256($signature_input, Encode::encode_utf8($user_token_secret));
      my $encoded_signature = $base64url_encode->($signature);

      $app->json_result("$encoded_header.$encoded_payload.$encoded_signature");
    }`,
          },
        },
      };
    }
  }

  exportedConfig.tags ??= {};
  exportedConfig.tags.function ??= {};
  for (const [key, value] of Object.entries(config.tags?.function ?? {})) {
    // inline perl code
    exportedConfig.tags.function[key] = `sub {
      require MT::Util;

      my ( $ctx, $args ) = @_;
      my $ua = MT->new_ua; # LWP::UserAgent
      my $res = $ua->post(
        '${value}',
        Content_Type => 'application/json',
        Content => Encode::encode('utf8', MT::Util::to_json({
          tag => '${key}',
          attributes => $args,
        })),
      );

      die $res->status_line . " " . $res->decoded_content if $res->is_error;

      if ($res->header('Content-Type') =~ /application\\/json/) {
        my $res_data = MT::Util::from_json($res->decoded_content);
        if (my $vars = $res_data->{variables} || $res_data->{vars}) {
          $ctx->stash('vars', $vars);
        }
        return defined($res_data->{contents}) ? $res_data->{contents} : "";
      }
      else {
        return $res->decoded_content;
      }
    }`;

    const lcKey = key.toLowerCase();
    phpFiles[`function.mt${lcKey}.php`] = `<?php
function smarty_function_mt${lcKey}($args, &$ctx) {
    try {
        $data = json_encode([
            'tag' => '${key}',
            'attributes' => $args,
        ]);

        $options = [
            'http' => [
                'method' => 'POST',
                'header' => [
                    'Content-Type: application/json',
                    'Content-Length: ' . strlen($data),
                ],
                'content' => $data,
            ],
        ];

        $context = stream_context_create($options);
        $response = file_get_contents('${value}', false, $context);

        if ($response === false) {
            error_log("Error in ${key} modifier: Failed to get response");
            return $content;
        }

        $responseHeaders = $http_response_header ?? [];
        $contentType = '';
        foreach ($responseHeaders as $header) {
            if (stripos($header, 'Content-Type:') === 0) {
                $contentType = $header;
                break;
            }
        }

        if (stripos($contentType, 'application/json') !== false) {
            $result = json_decode($response, true);
            $mt = MT::get_instance();
            $ctx =& $mt->context();
            if (array_key_exists('__inside_set_hashvar', $ctx->__stash)) {
                $vars =& $ctx->__stash['__inside_set_hashvar'];
            } else {
                $vars =& $ctx->__stash['vars'];
            }
            $new_vars = isset($result['vars'])
                ? $result['vars']
                : (isset($result['variables']) ? $result['variables'] : []);
            foreach ($new_vars as $key => $value) {
                $vars[$key] = $value;
            }
            return isset($result['contents']) ? $result['contents'] : '';
        } else {
            return $response;
        }
    } catch (Exception $e) {
        error_log("Error in ${key} modifier: " . $e->getMessage());
        return $content;
    }
}`;
  }

  exportedConfig.tags.block ??= {};
  for (const [key, value] of Object.entries(config.tags?.block ?? {})) {
    // inline perl code
    exportedConfig.tags.block[key] = `sub {
      require MT::Util;

      my ( $ctx, $args, $cond ) = @_;

      my $builder = $ctx->stash('builder');
      my $contents = $builder->build( $ctx, $ctx->stash('tokens'), $cond );
      die $ctx->error( $builder->errstr ) unless defined $contents;

      my $ua = MT->new_ua; # LWP::UserAgent
      my $res = $ua->post(
        '${value}',
        Content_Type => 'application/json',
        Content => Encode::encode('utf8', MT::Util::to_json({
          tag => '${key}',
          attributes => $args,
          contents => $contents,
        })),
      );

      die $res->status_line . " " . $res->decoded_content if $res->is_error;

      if ($res->header('Content-Type') =~ /application\\/json/) {
        my $res_data = MT::Util::from_json($res->decoded_content);
        if (my $vars = $res_data->{variables} || $res_data->{vars}) {
          $ctx->stash('vars', $vars);
        }
        return defined($res_data->{contents}) ? $res_data->{contents} : "";
      }
      else {
        return $res->decoded_content;
      }
    }`;

    const lcKey = key.toLowerCase();
    phpFiles[`block.mt${lcKey}.php`] = `<?php
$mt = MT::get_instance();
$ctx = &$mt->context();
$ctx->add_token_tag('mt${lcKey}');

function smarty_block_mt${lcKey}($args, $content, &$ctx, &$repeat) {
    if (isset($content)) {
        ob_start();
        $args['token_fn']($ctx, array(
            'conditional' => new class {
                public $value = true;
            }
        ));
        $content= ob_get_contents();
        ob_end_clean();
        unset($args['token_fn']);

        try {
            $data = json_encode([
                'tag' => '${key}',
                'attributes' => $args,
                'contents' => $content,
            ]);
    
            $options = [
                'http' => [
                    'method' => 'POST',
                    'header' => [
                        'Content-Type: application/json',
                        'Content-Length: ' . strlen($data),
                    ],
                    'content' => $data,
                ],
            ];
    
            $context = stream_context_create($options);
            $response = file_get_contents('${value}', false, $context);
    
            if ($response === false) {
                error_log("Error in ${key} modifier: Failed to get response");
                return $content;
            }
    
            $responseHeaders = $http_response_header ?? [];
            $contentType = '';
            foreach ($responseHeaders as $header) {
                if (stripos($header, 'Content-Type:') === 0) {
                    $contentType = $header;
                    break;
                }
            }
    
            if (stripos($contentType, 'application/json') !== false) {
                $result = json_decode($response, true);
                $mt = MT::get_instance();
                $ctx =& $mt->context();
                if (array_key_exists('__inside_set_hashvar', $ctx->__stash)) {
                    $vars =& $ctx->__stash['__inside_set_hashvar'];
                } else {
                    $vars =& $ctx->__stash['vars'];
                }
                $new_vars = isset($result['vars'])
                    ? $result['vars']
                    : (isset($result['variables']) ? $result['variables'] : []);
                foreach ($new_vars as $key => $value) {
                    $vars[$key] = $value;
                }
                return isset($result['contents']) ? $result['contents'] : '';
            } else {
                return $response;
            }
        } catch (Exception $e) {
            error_log("Error in ${key} modifier: " . $e->getMessage());
            return $content;
        }
    }
    
    return '';
}`;
  }

  exportedConfig.tags.modifier ??= {};
  for (const [key, value] of Object.entries(config.tags?.modifier ?? {})) {
    // inline perl code
    exportedConfig.tags.modifier[key] = `sub {
      require MT::Util;

      my ( $str, $arg, $ctx ) = @_;
      my $ua = MT->new_ua; # LWP::UserAgent
      my $res = $ua->post(
        '${value}',
        Content_Type => 'application/json',
        Content => Encode::encode('utf8', MT::Util::to_json({
          modifier => '${key}',
          attributes => {
            '${key}' => $arg,
          },
          contents => $str,
        })),
      );

      die $res->status_line . " " . $res->decoded_content if $res->is_error;

      if ($res->header('Content-Type') =~ /application\\/json/) {
        my $res_data = MT::Util::from_json($res->decoded_content);
        if (my $vars = $res_data->{variables} || $res_data->{vars}) {
          $ctx->stash('vars', $vars);
        }
        return defined($res_data->{contents}) ? $res_data->{contents} : "";
      }
      else {
        return $res->decoded_content;
      }
    }`;

    const lcKey = key.toLowerCase();
    phpFiles[`modifier.${lcKey}.php`] = `<?php
function smarty_modifier_${lcKey}($str, $attr) {
    try {
        $data = json_encode([
            'modifier' => '${key}',
            'attributes' => [
                '${key}' => $attr,
            ],
            'contents' => $str,
        ]);

        $options = [
            'http' => [
                'method' => 'POST',
                'header' => [
                    'Content-Type: application/json',
                    'Content-Length: ' . strlen($data),
                ],
                'content' => $data,
            ],
        ];

        $context = stream_context_create($options);
        $response = file_get_contents('${value}', false, $context);

        if ($response === false) {
            error_log("Error in ${key} modifier: Failed to get response");
            return $str;
        }

        $responseHeaders = $http_response_header ?? [];
        $contentType = '';
        foreach ($responseHeaders as $header) {
            if (stripos($header, 'Content-Type:') === 0) {
                $contentType = $header;
                break;
            }
        }

        if (stripos($contentType, 'application/json') !== false) {
            $result = json_decode($response, true);
            $mt = MT::get_instance();
            $ctx =& $mt->context();
            if (array_key_exists('__inside_set_hashvar', $ctx->__stash)) {
                $vars =& $ctx->__stash['__inside_set_hashvar'];
            } else {
                $vars =& $ctx->__stash['vars'];
            }
            $new_vars = isset($result['vars'])
                ? $result['vars']
                : (isset($result['variables']) ? $result['variables'] : []);
            foreach ($new_vars as $key => $value) {
                $vars[$key] = $value;
            }
            return isset($result['contents']) ? $result['contents'] : '';
        } else {
            return $response;
        }
    } catch (Exception $e) {
        error_log("Error in ${key} modifier: " . $e->getMessage());
        return $str;
    }
}`;
  }

  const yamlContent = yaml.dump(exportedConfig);

  const pluginDir = path.join(tmpDir, "plugins", config.id as string);
  const yamlPath = path.join(pluginDir, "config.yaml");

  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(yamlPath, yamlContent);

  if (Object.keys(phpFiles).length > 0) {
    const phpDir = path.join(pluginDir, "php");
    fs.mkdirSync(phpDir, { recursive: true });
    for (const [filename, content] of Object.entries(phpFiles)) {
      fs.writeFileSync(path.join(phpDir, filename), content);
    }
  }
}

const program = new Command();
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
);

program
  .name("mt-plugin-builder")
  .description("Build tool for MT plugins")
  .version(packageJson.version)
  .option("-o, --output <filename>", "Output zip file name")
  .action(async (options) => {
    try {
      const config = await loadConfig();
      const packageJson = fs.existsSync(
        path.resolve(process.cwd(), "package.json")
      )
        ? JSON.parse(
            fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
          )
        : {};

      config.id ??= packageJson.name.replace(/^@[^\/]+\//, "");
      config.name ??= packageJson.name;
      config.version ??= packageJson.version;
      config.description ??= packageJson.description;
      if (typeof packageJson.author === "object") {
        config.author_name ??= packageJson.author.name;
        config.author_link ??= packageJson.author.url;
      } else if (typeof packageJson.author === "string") {
        const authorMatch = packageJson.author.match(
          /^([^<(]+?)(?:\s*(?:<(.+?)>|\((.*?)\)))?$/
        );
        if (authorMatch) {
          config.author_name ??= authorMatch[1].trim();
          config.author_link ??= authorMatch[2] || authorMatch[3];
        } else {
          config.author_name ??= packageJson.author;
        }
      }

      (["id", "name", "version"] as const).forEach((key) => {
        if (config[key] == null) {
          throw new Error(`${key} is required.`);
        }
      });

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-plugin-"));
      createConfigYaml(config, tmpDir);

      if (config.mt_static) {
        const mtStaticDir = path.join(
          tmpDir,
          "mt-static",
          "plugins",
          config.id as string
        );
        fs.mkdirSync(mtStaticDir, { recursive: true });
        fs.cpSync(config.mt_static, mtStaticDir, { recursive: true });
      }

      const output = fs.createWriteStream(
        options.output ?? `${config.id}-${config.version}.zip`
      );
      const archive = archiver("zip", {
        zlib: { level: 9 },
      });

      output.on("close", () => {
        console.log(`${archive.pointer()} bytes total`);
        console.log("Archive completed.");
      });

      archive.on("error", (err) => {
        throw err;
      });

      archive.pipe(output);
      archive.directory(tmpDir, false);

      await archive.finalize();
    } catch (error) {
      console.error("An error occurred:", error);
      process.exit(1);
    }
  });

program.parse();
