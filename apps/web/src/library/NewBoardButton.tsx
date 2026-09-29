import { useState } from "react";
import { useLocation } from "wouter";
import { createBoard, errorMessage } from "./libraryApi";

/** BRD-01: создаёт доску и сразу открывает её. */
export function NewBoardButton() {
  const [, navigate] = useLocation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setPending(true);
    setError(null);
    try {
      const board = await createBoard();
      navigate(`/boards/${board.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <div className="library-new">
      <button type="button" disabled={pending} onClick={() => void create()}>
        New board
      </button>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
