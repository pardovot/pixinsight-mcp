import { z } from "zod";

export const viewIdField = z.string().describe("Id of an open view (main view or preview)");
