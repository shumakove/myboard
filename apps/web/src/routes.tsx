import { Redirect, Route, Switch } from "wouter";
import { RequireAccount } from "./account/RequireAccount";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { BoardPage } from "./pages/BoardPage";
import { BoardsPage } from "./pages/BoardsPage";
import { EmbeddedBoardPage } from "./pages/EmbeddedBoardPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SharedBoardPage } from "./pages/SharedBoardPage";
import { TemplateCopyPage } from "./pages/TemplateCopyPage";
import { TemplatesPage } from "./pages/TemplatesPage";

/** Маршруты интерфейса (ARCHITECTURE.md, раздел 4). */
export function AppRoutes() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      {/* Страницы пользователя досок уходят на /login без сессии и при её отзыве (ACC-05). */}
      <Route path="/">
        <RequireAccount>
          <BoardsPage />
        </RequireAccount>
      </Route>
      <Route path="/boards/:id">
        <RequireAccount>
          <BoardPage />
        </RequireAccount>
      </Route>
      <Route path="/templates">
        <RequireAccount>
          <TemplatesPage />
        </RequireAccount>
      </Route>
      <Route path="/t/:token" component={TemplateCopyPage} />
      {/* Раздел 2 архитектуры: администратор «открывает /admin» — это вход в панель. */}
      <Route path="/admin">
        <Redirect to="/admin/users" replace />
      </Route>
      <Route path="/admin/login" component={AdminLoginPage} />
      <Route path="/admin/users" component={AdminUsersPage} />
      {/* `?object={id}` читает страница доски, отдельного маршрута нет. */}
      <Route path="/b/:token" component={SharedBoardPage} />
      <Route path="/b/:token/embed" component={EmbeddedBoardPage} />
      <Route component={NotFoundPage} />
    </Switch>
  );
}
