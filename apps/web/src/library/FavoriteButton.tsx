import { useState } from "react";
import { errorMessage, setFavorite, type FavoriteKind } from "./libraryApi";

/** BRD-07: звезда — добавить доску или папку в избранное и убрать. */
export function FavoriteButton({
  kind,
  id,
  favorite,
  onChange,
  onError,
}: {
  kind: FavoriteKind;
  id: string;
  favorite: boolean;
  onChange: () => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    try {
      await setFavorite(kind, id, !favorite);
      onChange();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className="library-star"
      aria-label="Favorite"
      aria-pressed={favorite}
      title={favorite ? "Remove from favorites" : "Add to favorites"}
      disabled={pending}
      onClick={() => void toggle()}
    >
      {favorite ? "★" : "☆"}
    </button>
  );
}
