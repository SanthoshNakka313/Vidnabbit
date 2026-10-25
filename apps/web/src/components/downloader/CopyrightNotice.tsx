import Link from "next/link";
import { IconInfo } from "../icons";
import { linkInline } from "../ui/styles";

/** Non-blocking user notice shown directly above the download/save button. */
export function CopyrightNotice() {
  return (
    <p className="flex items-start gap-2 text-sm text-muted" data-testid="copyright-notice">
      <IconInfo size={18} className="mt-0.5 shrink-0" />
      <span>
        Only download content you own or have permission to use.{" "}
        <Link href="/terms" className={linkInline}>
          Terms
        </Link>
      </span>
    </p>
  );
}
