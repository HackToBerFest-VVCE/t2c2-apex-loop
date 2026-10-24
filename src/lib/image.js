function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be opened as an image.'));
    };
    img.src = url;
  });
}

function toJpeg(img, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Resizes a photo once for the model (sharp enough to analyse) and once as a small
 * thumbnail that fits comfortably in localStorage.
 */
export async function prepareImage(file) {
  const img = await loadImage(file);
  const full = toJpeg(img, 1280, 0.85);
  const thumb = toJpeg(img, 360, 0.72);
  return {
    preview: full,
    thumb,
    base64: full.split(',')[1],
    mimeType: 'image/jpeg',
  };
}
