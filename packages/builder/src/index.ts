export interface PluginConfig {
  /**
   * Plugin ID
   */
  id?: string;
  /**
   * Plugin name
   */
  name?: string;
  /**
   * Plugin version
   */
  version?: string;
  /**
   * Author link
   */
  author_link?: string;
  /**
   * Author name
   */
  author_name?: string;
  /**
   * Plugin description
   */
  description?: string;
  /**
   * Script file
   * insert mt-static/plugin/plugin-name/${script} to Admin Interface
   */
  script?: string;
  /**
   * User token secret
   */
  user_token_secret?: string;
  /**
   * Static directory
   * copy ${mt_static} to mt-static/plugin/plugin-name/
   */
  mt_static?: string;
  /**
   * Tags
   */
  tags?: {
    /**
     * Function tags
     */
    function?: Record<string, string>;
    /**
     * Block tags
     */
    block?: Record<string, string>;
    /**
     * Modifier tags
     */
    modifier?: Record<string, string>;
  };
  callbacks?: {
    /**
     * pre save callback for entry
     */
    "MT::Entry::pre_save"?: string;
    /**
     * post save callback for entry
     */
    "MT::Entry::post_save"?: string;
    /**
     * pre save callback for ContentData
     */
    "MT::ContentData::pre_save"?: string;
    /**
     * post save callback for ContentData
     */
    "MT::ContentData::post_save"?: string;
    /**
     * pre build callback
     */
    "pre_build"?: string;
    /**
     * rebuild callback
     */
    "rebuild"?: string;
    /**
     * post build callback
     */
    "post_build"?: string;
    [key: string]: string | undefined;
  };
}

export const defineConfig = (config: PluginConfig): PluginConfig => {
  return config;
};
