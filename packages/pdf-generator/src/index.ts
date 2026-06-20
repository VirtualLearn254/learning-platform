/**
 * @lp/pdf-generator — produces branded PDFs from lessons.
 *
 * Two PDF flavors:
 *   • "content" — the script + on-screen text + key takeaways, formatted as a
 *     reading companion (produced at the content-creation stage, before video).
 *   • "summary" — a 1-2 page recap with key concepts + quiz answers (produced
 *     after the lesson is published).
 *
 * Implementation plan: render a React component server-side via React PDF or
 * Puppeteer, write to S3. Brand template (logo + colors + typography) is a
 * single CSS file we'll add to packages/pdf-generator/src/brand/.
 */

import type { Lesson, Beat } from "@lp/shared";

export type PdfFlavor = "content" | "summary";

export interface BrandConfig {
  organizationName: string;
  /** Primary brand color (hex). */
  primaryColor: string;
  /** Logo as a data URL or HTTPS URL. */
  logoUrl?: string;
  footerText?: string;
}

export interface BuildPdfInput {
  flavor: PdfFlavor;
  lesson: Lesson;
  beats: Beat[];
  branding: BrandConfig;
  /** S3 key for the output. */
  outputKey: string;
}

export interface BuildPdfOutput {
  pdfKey: string;
  pageCount: number;
  sizeBytes: number;
}

export interface PdfGenerator {
  build(input: BuildPdfInput): Promise<BuildPdfOutput>;
}

export function createPdfGenerator(): PdfGenerator {
  return {
    async build(input) {
      // Placeholder: count words in scripts to estimate page count.
      const wordCount = input.beats.reduce((n, b) => n + b.script.split(/\s+/).length, 0);
      const estPages = Math.max(1, Math.ceil(wordCount / 350));
      return { pdfKey: input.outputKey, pageCount: estPages, sizeBytes: 0 };
    },
  };
}
