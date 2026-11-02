import { useCallback, useState, type ReactNode } from "react";
import { Button, FloatingPanel } from "../ui";
import { UploadError } from "./mediaApi";

const NOT_AN_IMAGE = "This file is not an image that can be shown.";

type Status = { kind: "busy" | "error"; text: string } | null;

/** Запустить долгое действие с файлом: `text` видно, пока оно идёт. */
export type RunFileTask = (
  text: string,
  work: () => Promise<void>,
) => Promise<void>;

/** Долгое действие с файлами на доске: строка «идёт», затем ошибка или ничего. */
export function useFileTask(): {
  busy: boolean;
  run: RunFileTask;
  /** Строка состояния. */
  notice: ReactNode;
} {
  const [status, setStatus] = useState<Status>(null);

  const run = useCallback<RunFileTask>(async (text, work) => {
    setStatus({ kind: "busy", text });
    try {
      await work();
      setStatus(null);
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof UploadError ? error.message : NOT_AN_IMAGE,
      });
    }
  }, []);

  const notice =
    status === null ? null : (
      <FloatingPanel
        role={status.kind === "error" ? "alert" : "status"}
        className="board-notice"
      >
        {status.text}
        {status.kind === "error" && (
          <Button
            variant="ghost"
            onClick={() => {
              setStatus(null);
            }}
          >
            Dismiss
          </Button>
        )}
      </FloatingPanel>
    );

  return { busy: status?.kind === "busy", run, notice };
}
