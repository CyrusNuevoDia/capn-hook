export type AnswerGrade = {
  ambiguous: boolean;
  correct: boolean;
  coverage: {
    ambiguousFiles: string[];
    fraction: number;
    matchedFiles: string[];
    missingFiles: string[];
    requiredFiles: string[];
    status: "complete" | "partial" | "missing";
  };
  scoring: "required-files-v1";
};

const regexMetacharacters = /[.*+?^${}()|[\]\\]/g;

const mentionsPath = (
  answer: string,
  filePath: string,
  allowAbsolutePrefix: boolean
): boolean => {
  const escapedPath = filePath.replace(regexMetacharacters, "\\$&");
  const prefix = allowAbsolutePrefix ? "(?:\\./|/(?:[^\\s`\"'<>]+/)*)?" : "";
  // Bound the whole path so handler.tsx, handler.ts.bak, and wrongsrc/handler.ts
  // cannot satisfy src/handler.ts. A checkout prefix is accepted only if absolute.
  const pattern = new RegExp(
    `(?:^|[\\s\`"'(<\\[{,;=])${prefix}${escapedPath}` +
      "(?::\\d+(?::\\d+)?|#L\\d+(?:-L\\d+)?)?" +
      "(?=$|[\\s`\"'<>),;\\]}!?]|\\.(?=$|[\\s`\"'<>),;\\]}]))"
  );
  return pattern.test(answer);
};

/** Required-file coverage is mechanical citation evidence, not semantic grading. */
export const gradeAnswer = (
  answer: string,
  groundTruthFiles: string[]
): AnswerGrade => {
  const requiredFiles = [...new Set(groundTruthFiles)];
  const matchedFiles = requiredFiles.filter((filePath) =>
    mentionsPath(answer, filePath, true)
  );
  const missingFiles = requiredFiles.filter(
    (filePath) => !matchedFiles.includes(filePath)
  );
  const ambiguousFiles = missingFiles.filter((filePath) => {
    const basename = filePath.split("/").at(-1) ?? filePath;
    return mentionsPath(answer, basename, false);
  });
  const correct = requiredFiles.length > 0 && missingFiles.length === 0;
  let status: AnswerGrade["coverage"]["status"] = "missing";
  if (correct) {
    status = "complete";
  } else if (matchedFiles.length > 0) {
    status = "partial";
  }

  return {
    ambiguous: ambiguousFiles.length > 0,
    correct,
    coverage: {
      ambiguousFiles,
      fraction:
        requiredFiles.length > 0
          ? matchedFiles.length / requiredFiles.length
          : 0,
      matchedFiles,
      missingFiles,
      requiredFiles,
      status,
    },
    scoring: "required-files-v1",
  };
};
