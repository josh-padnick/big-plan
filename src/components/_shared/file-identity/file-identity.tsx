// Owns the file-identity caption shared by file-associated components.

import { FILE_ICON } from "../../../icons/lucide/file.js";
import { lucideIconToReact } from "../lucide-icon/lucide-icon.js";

// The explicit label keeps the accessible name the exact file path,
// independent of the styled dir/name split below.
export const FileIdentity = ({
  filePath,
  size = "default",
}: {
  readonly filePath: string;
  readonly size?: "default" | "compact";
}) => {
  const lastSlashIndex = filePath.lastIndexOf("/");
  const fileDir =
    lastSlashIndex === -1 ? "" : filePath.slice(0, lastSlashIndex + 1);
  const fileName =
    lastSlashIndex === -1 ? filePath : filePath.slice(lastSlashIndex + 1);
  return (
    <span
      className={`file-identity flex min-w-0 items-center gap-2 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted ${size === "compact" ? "text-xs" : ""}`}
      aria-label={filePath}
    >
      {lucideIconToReact({ icon: FILE_ICON, hidden: false })}
      <span className="file-identity-path min-w-0 truncate">
        {fileDir === "" ? null : (
          <span className="file-identity-dir text-muted">{fileDir}</span>
        )}
        <span className="file-identity-name font-semibold text-ink">
          {fileName}
        </span>
      </span>
    </span>
  );
};
