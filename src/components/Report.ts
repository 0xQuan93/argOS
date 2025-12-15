import { z } from "zod";
import { createComponent } from "./createComponent";

export const ReportSchema = z.object({
  requestId: z.number(),
});

export const ReportComponent = createComponent("Report", ReportSchema, {
  requestId: [] as number[],
});

export const Report = ReportComponent.component;
