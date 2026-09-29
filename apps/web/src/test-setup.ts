import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom не прокручивает: боковой список вызывает scrollIntoView у найденной папки.
Element.prototype.scrollIntoView = () => undefined;
