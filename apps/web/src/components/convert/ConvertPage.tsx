import type { ReactNode } from "react";
import { Breadcrumbs } from "@/app/_seo/content-parts";
import { Faq } from "../home/Faq";
import { ProductEyebrow, ProductSwitch } from "../hub/products";
import { ConvertTabs } from "./ConvertTabs";

interface ConvertPageProps {
  tab: "/convert/images" | "/convert/documents";
  crumb: string;
  title: ReactNode;
  intro: string;
  children: ReactNode;
  faq: { q: string; a: string }[];
}

/** Shared layout for the converter pages: hero, tabs, the tool in a card, then FAQs. */
export function ConvertPage({ tab, crumb, title, intro, children, faq }: ConvertPageProps) {
  return (
    <>
      <div className="vn-hero-glow">
        <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-4 pb-12 pt-8 sm:px-6 sm:pt-12">
          <Breadcrumbs trail={[{ name: crumb, path: tab }]} />
          <div className="flex flex-col items-center gap-4 text-center">
            <ProductEyebrow product="convabbit" />
            <h1 className="text-balance text-3xl sm:text-4xl">{title}</h1>
            <p className="max-w-xl text-pretty text-lg text-muted">{intro}</p>
          </div>
          <ConvertTabs current={tab} />
          <div className="rounded-xl border border-border bg-surface p-5 shadow-lg sm:p-8">{children}</div>
          <ProductSwitch to="vidnabbit" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-content px-4 py-14 sm:px-6">
        <Faq items={faq} />
      </div>
    </>
  );
}
