import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { article, breadcrumbList, type Crumb } from "@/components/seo/schema";
import { guides, type GuideEntry } from "@/lib/site";

/** Visible breadcrumb trail plus matching BreadcrumbList JSON-LD. */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  const all = [{ name: "Home", path: "/" }, ...trail];
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
        <ol className="m-0! flex list-none! flex-wrap gap-x-2 p-0!">
          {all.map((c, i) => (
            <li key={c.path} className="m-0! flex items-center gap-x-2">
              {i < all.length - 1 ? (
                <>
                  <Link href={c.path}>{c.name}</Link>
                  <span aria-hidden="true">/</span>
                </>
              ) : (
                <span aria-current="page">{c.name}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <JsonLd data={breadcrumbList(trail)} />
    </>
  );
}

/** Breadcrumbs + Article JSON-LD for a guide, from its entry in site.ts. */
export function GuideHeader({ guide, description }: { guide: GuideEntry; description: string }) {
  return (
    <>
      <Breadcrumbs
        trail={[
          { name: "Guides", path: "/guides" },
          { name: guide.label, path: guide.href },
        ]}
      />
      <JsonLd
        data={article({
          headline: guide.label,
          description,
          path: guide.href,
          published: guide.published,
          updated: guide.updated,
        })}
      />
    </>
  );
}

export function UpdatedLine({ guide }: { guide: GuideEntry }) {
  const date = new Date(`${guide.updated}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <p className="text-sm text-muted">
      Updated <time dateTime={guide.updated}>{date}</time>
    </p>
  );
}

export function guideByHref(href: string): GuideEntry {
  const g = guides.find((x) => x.href === href);
  if (!g) throw new Error(`Unknown guide ${href}`);
  return g;
}

/** "Keep reading" links to the other guides, the formats page and the FAQ. */
export function RelatedGuides({ current }: { current?: string }) {
  const others = guides.filter((g) => g.href !== current);
  return (
    <>
      <h2>Keep reading</h2>
      <ul>
        {others.map((g) => (
          <li key={g.href}>
            <Link href={g.href}>{g.label}</Link>: {g.summary}
          </li>
        ))}
        {current !== "/formats" && (
          <li>
            <Link href="/formats">Formats and quality</Link>: every option VidNabbit offers, explained.
          </li>
        )}
        <li>
          <Link href="/faq">FAQ</Link>: quick answers about limits, privacy and refused links.
        </li>
      </ul>
      <p>
        Ready? <Link href="/download">Paste a link and nab it</Link>.
      </p>
    </>
  );
}
