import { PagePlaceholder } from "./PagePlaceholder";

/**
 * `/b/{token}` и `/b/{token}?object={id}` — участник по ссылке: имя, затем холст
 * (SHR-02, SHR-03, T3.1; переход к объекту — SHR-07, T5.5).
 */
export function SharedBoardPage() {
  return <PagePlaceholder title="Shared board" />;
}
