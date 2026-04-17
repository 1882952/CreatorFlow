/**
 * ComfyUI File Uploader
 *
 * Handles uploading image assets to the ComfyUI server's /upload/image endpoint.
 * Uses the ComfyUIClient to resolve the server base URL and provides automatic
 * retry logic for transient failures.
 */
export class FileUploader {
  /** @type {import('./comfyui-client.js').ComfyUIClient} */
  #client;

  /** Maximum upload retry attempts beyond the initial request. */
  static #MAX_RETRIES = 2;

  /** Base upload timeout in milliseconds. */
  static #UPLOAD_TIMEOUT = 60000;

  constructor(client) {
    this.#client = client;
  }

  /**
   * Upload a file to the ComfyUI server's input directory.
   *
   * @param {File|Blob} file - The file to upload
   * @param {object} [options]
   * @param {'image'} [options.kind='image'] - Asset kind tag (for caller bookkeeping)
   * @param {string} [options.filenameHint] - Preferred filename on the server
   * @param {boolean} [options.overwrite=false] - Whether to overwrite existing files
   * @returns {Promise<{name: string, subfolder: string, type: string, originalName: string, kind: string}>}
   *   Metadata about the uploaded file
   * @throws {Error} If all retry attempts are exhausted
   */
  async uploadAsset(file, options = {}) {
    const { kind = 'image', filenameHint, overwrite = false } = options;
    let lastError;

    for (let attempt = 0; attempt <= FileUploader.#MAX_RETRIES; attempt++) {
      try {
        return await this.#attemptUpload(file, filenameHint, overwrite, kind);
      } catch (err) {
        lastError = err;
        if (attempt < FileUploader.#MAX_RETRIES) {
          console.warn(
            `[FileUploader] Retry ${attempt + 1} for ${file.name}:`,
            err.message,
          );
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError || new Error('Upload failed');
  }

  /**
   * Execute a single upload attempt.
   * @private
   */
  async #attemptUpload(file, filenameHint, overwrite, kind) {
    const formData = new FormData();
    formData.append('image', file, filenameHint || file.name);
    formData.append('type', 'input');
    if (overwrite) formData.append('overwrite', 'true');

    // Derive the base URL from the client's getViewUrl helper.
    // getViewUrl returns e.g. "http://host:8188/view?filename=test&subfolder=&type=output"
    // We strip from "/view?" onward to get the clean base URL.
    const viewUrl = this.#client.getViewUrl({
      filename: 'test',
      type: 'output',
    });
    const baseUrl = viewUrl.replace(/\/view\?.*$/, '');

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      FileUploader.#UPLOAD_TIMEOUT,
    );

    const resp = await fetch(`${baseUrl}/upload/image`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Upload failed (${resp.status}): ${text}`);
    }

    const result = await resp.json();
    return {
      name: result.name,
      subfolder: result.subfolder || '',
      type: result.type || 'input',
      originalName: file.name,
      kind,
    };
  }
}
