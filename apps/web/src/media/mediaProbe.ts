/** Что браузер прочитал в ролике: размер кадра; без дорожки видео — 0×0. */
export interface VideoProbe {
  width: number;
  height: number;
}

/** Столько ждём чтения заголовка ролика, мс. */
const PROBE_TIMEOUT = 5000;

/**
 * Размер кадра ролика до загрузки (FIL-03) и наличие дорожки видео: файл `.webm` только со
 * звуком — аудио (FIL-04). Браузер не может прочитать файл — `null`.
 */
export function probeVideo(file: Blob): Promise<VideoProbe | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const finish = (probe: VideoProbe | null) => {
      clearTimeout(timer);
      video.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(probe);
    };
    const timer = setTimeout(() => {
      finish(null);
    }, PROBE_TIMEOUT);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      finish({ width: video.videoWidth, height: video.videoHeight });
    };
    video.onerror = () => {
      finish(null);
    };
    video.src = url;
  });
}
