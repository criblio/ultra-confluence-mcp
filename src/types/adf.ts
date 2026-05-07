/**
 * Atlassian Document Format (ADF) type definitions.
 * Shared between the markdown→ADF (write) and ADF→markdown (read) converters.
 */

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

export interface AdfDocument {
  type: "doc";
  content: AdfNode[];
  version: 1;
}
