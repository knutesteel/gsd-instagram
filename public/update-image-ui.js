(() => {
  const CHAT_URL = 'https://chatgpt.com/g/g-p-69e8effb73588191acaccbaed49a9d96/c/6a5fd350-e1f8-83ea-a391-a1e3cd4b4dcb';
  const ROOT_CLASS = 'generated-image-update-panel';

  const currentStatus = () => {
    const control = document.querySelector('.detail-status-control select');
    return control instanceof HTMLSelectElement ? control.value : '';
  };

  const activeImage = () => {
    const image = document.querySelector('.detail-asset-stage img');
    if (!(image instanceof HTMLImageElement)) return null;
    return {
      src: image.currentSrc || image.src,
      alt: image.alt || 'generated image',
    };
  };

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText && document.hasFocus()) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('The browser blocked clipboard access.');
  };

  const promptFor = (request, image) => [
    'Update the currently selected generated image using the image-editing tool.',
    '',
    `Image to update: ${image.src}`,
    `Selected image: ${image.alt}`,
    '',
    'Requested changes:',
    request.trim(),
    '',
    'Critical editing instructions:',
    '- Make only the requested changes.',
    '- Keep every other element of the image exactly the same.',
    '- Preserve the existing characters, poses, expressions, clothing, props, background, composition, camera angle, crop, lighting, color palette, text, speech bubbles, dimensions, and visual style unless a requested change explicitly requires otherwise.',
    '- Do not add, remove, rewrite, reposition, or reinterpret anything that was not specifically requested.',
    '- Return the revised image only after applying the requested corrections.',
  ].join('\n');

  const showMessage = (panel, message, kind = 'success') => {
    const node = panel.querySelector('[data-update-image-message]');
    if (!node) return;
    node.textContent = message;
    node.className = `generated-image-update-message ${kind}`;
  };

  const submit = async (panel) => {
    const input = panel.querySelector('textarea');
    const button = panel.querySelector('button');
    const request = input instanceof HTMLTextAreaElement ? input.value.trim() : '';
    const image = activeImage();
    if (!request) return showMessage(panel, 'Describe the exact image changes first.', 'error');
    if (!image?.src) return showMessage(panel, 'No generated image is currently selected.', 'error');

    let chatWindow = null;
    try {
      if (button instanceof HTMLButtonElement) {
        button.disabled = true;
        button.textContent = 'Opening ChatGPT…';
      }
      chatWindow = window.open('about:blank', '_blank');
      if (!chatWindow) throw new Error('Allow popups for this site and try again.');
      chatWindow.opener = null;
      await copyText(promptFor(request, image));
      chatWindow.location.href = CHAT_URL;
      showMessage(panel, 'Update command copied. ChatGPT opened—paste the command to update the selected image.');
    } catch (error) {
      if (chatWindow && !chatWindow.closed) chatWindow.close();
      showMessage(panel, error instanceof Error ? error.message : 'Could not open the image update workflow.', 'error');
    } finally {
      if (button instanceof HTMLButtonElement) {
        button.disabled = false;
        button.textContent = 'Update Image in ChatGPT';
      }
    }
  };

  const buildPanel = () => {
    const panel = document.createElement('section');
    panel.className = ROOT_CLASS;
    panel.innerHTML = `
      <div class="generated-image-update-heading">
        <div>
          <h3>Update Image</h3>
          <p>Describe only the changes needed for the currently displayed image. All other image elements will be explicitly preserved.</p>
        </div>
      </div>
      <label>
        <span>Requested image changes</span>
        <textarea rows="5" placeholder="Example: Make Hank look surprised instead of worried. Keep every other character, object, word, position, and visual detail unchanged."></textarea>
      </label>
      <div class="generated-image-update-actions">
        <button type="button" class="button primary">Update Image in ChatGPT</button>
        <small data-update-image-message aria-live="polite"></small>
      </div>`;
    panel.querySelector('button')?.addEventListener('click', () => void submit(panel));
    return panel;
  };

  const sync = () => {
    const existing = document.querySelector(`.${ROOT_CLASS}`);
    const isGenerationPage = document.querySelector('.generation-suggestions-header');
    const target = document.querySelector('.detail-generated-content');
    const shouldShow = Boolean(isGenerationPage && target && currentStatus() === 'Generated');

    if (!shouldShow) {
      existing?.remove();
      return;
    }
    if (existing) return;
    target?.insertAdjacentElement('afterend', buildPanel());
  };

  document.addEventListener('change', (event) => {
    if (event.target instanceof HTMLSelectElement && event.target.closest('.detail-status-control')) {
      window.setTimeout(sync, 0);
    }
  });

  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(sync, 1000);
  sync();
})();