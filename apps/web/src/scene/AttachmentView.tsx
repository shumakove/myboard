import { formatSize, type AttachmentShape } from "./attachmentData";
import { mediaUrl } from "./imageData";
import { MediaPlayer } from "./MediaPlayer";
import { PdfView } from "./PdfView";

/** Файл на холсте (T7.2): ярлык (FIL-01), PDF (FIL-02), видео и аудио (FIL-03, FIL-04). */
export function AttachmentView({
  type,
  file,
}: {
  type: string;
  file: AttachmentShape;
}) {
  if (type === "pdf") return <PdfView file={file} />;
  if (type === "video" || type === "audio") {
    return (
      <div className="media-object">
        {type === "audio" && <span className="media-name">{file.name}</span>}
        <MediaPlayer kind={type} src={mediaUrl(file.media)} />
      </div>
    );
  }
  return (
    <div className="file-shortcut">
      <svg className="file-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 2h8l5 5v15H6z" />
        <path d="M14 2v5h5" />
      </svg>
      <span className="file-text">
        <span className="file-name">{file.name}</span>
        <span className="file-size">{formatSize(file.size)}</span>
      </span>
    </div>
  );
}
