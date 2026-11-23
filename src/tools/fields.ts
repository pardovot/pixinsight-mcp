import { z } from "zod";

export const viewIdField = z.string().describe("Id of an open view: a main view, or a preview as <image>-><preview>");

// An id PixInsight accepts for a new view or icon: a letter or underscore, then letters, digits and underscores.
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const identifierField = z.string().regex(IDENTIFIER_PATTERN, "Letters, digits and underscores only, not starting with a digit");
