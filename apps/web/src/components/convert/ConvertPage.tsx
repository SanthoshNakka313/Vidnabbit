import type { ReactNode } from "react";
import { Breadcrumbs } from "@/app/_seo/content-parts";
import { Faq } from "../home/Faq";
import { ProductEyebrow, ProductSwitch, type ProductId } from "../hub/products";
import { ConvertTabs } from "./ConvertTabs";

interface ConvertPageProps {
  /** This page's path (for the breadcrumb and the current tab). */
  tab: string;
  product?: ProductId;
  /** The tab switch above the tool; defaults to Images / Documents. */
  tabs?: ReactNode;
  /** The other product linked under the tool. */
  switchTo?: ProductId;
  /** Side-by-side tools (resume + job ad) get the full page width. */
  wide?: boolean;
  crumb: string;
  title: ReactNode;
  intro: string;
  children: ReactNode;
  faq: { q: string; a: string }[];
}

/** Shared layout for the tool pages: hero, tabs, the tool in a card, then FAQs. */
export function ConvertPage({ tab, product = "convabbit", tabs, switchTo = "vidnabbit", wide = false, crumb, title, intro, children, faq }: ConvertPageProps) {
  return (
    <>
      <div className="vn-hero-glow">
        <div className={`mx-auto flex w-full ${wide ? "max-w-page" : "max-w-content"} flex-col gap-6 px-4 pb-12 pt-8 sm:px-6 sm:pt-12`}>
          <Breadcrumbs trail={[{ name: crumb, path: tab }]} />
          <div className="flex flex-col items-center gap-4 text-center">
            <ProductEyebrow product={product} />
            <h1 className="text-balance text-3xl sm:text-4xl">{title}</h1>
            <p className="max-w-xl text-pretty text-lg text-muted">{intro}</p>
          </div>
          {tabs ?? <ConvertTabs current={tab as "/convert/images" | "/convert/documents"} />}
          <div className="rounded-xl border border-border bg-surface p-5 shadow-lg sm:p-8">{children}</div>
          <ProductSwitch to={switchTo} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-content px-4 py-14 sm:px-6">
        <Faq items={faq} />
      </div>
    </>
  );
}
