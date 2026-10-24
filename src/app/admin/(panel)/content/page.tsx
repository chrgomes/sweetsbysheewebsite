import { asc } from "drizzle-orm";
import Image from "next/image";
import Link from "next/link";
import { saveFaq, saveGalleryItem, savePage, saveTestimonial } from "@/app/admin/actions/content";
import { AdminForm } from "@/components/admin/admin-form";
import { AdminHeader, Panel } from "@/components/admin/ui";
import { Input, Select, Textarea } from "@/components/ui/field";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "Site content" };

const TABS = [
  { key: "faqs", label: "FAQs" },
  { key: "pages", label: "About & policies" },
  { key: "gallery", label: "Gallery" },
  { key: "testimonials", label: "Testimonials" },
] as const;

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[var(--berry)]" /> {label}
    </label>
  );
}

function DeleteToggle() {
  return (
    <label className="flex items-center gap-2 text-sm text-danger">
      <input type="checkbox" name="intent" value="delete" /> Delete
    </label>
  );
}

export default async function ContentPage({ searchParams }: PageProps<"/admin/content">) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "faqs";

  return (
    <>
      <AdminHeader title="Site content" description="Everything here is shown publicly once published." />
      <nav aria-label="Content sections" className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/content?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined} className="rounded-full border border-line-strong px-3 py-1.5 text-sm aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-cream">
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "faqs" && <Faqs />}
      {tab === "pages" && <Pages />}
      {tab === "gallery" && <Gallery />}
      {tab === "testimonials" && <Testimonials />}
    </>
  );
}

async function Faqs() {
  const rows = await db().query.faqs.findMany({ orderBy: [asc(schema.faqs.sortOrder)] });
  const fields = (f?: (typeof rows)[number]) => (
    <>
      {f && <input type="hidden" name="id" value={f.id} />}
      <label className="block text-sm">Question<Input id={`q-${f?.id ?? "new"}`} name="question" defaultValue={f?.question} className="mt-1 py-2" /></label>
      <label className="block text-sm">Answer<Textarea id={`a-${f?.id ?? "new"}`} name="answer" defaultValue={f?.answer} rows={3} className="mt-1" /></label>
      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-sm">Order<Input id={`o-${f?.id ?? "new"}`} name="sortOrder" defaultValue={f?.sortOrder ?? 0} className="w-20 py-1.5" inputMode="numeric" /></label>
        <Check name="published" label="Published" defaultChecked={f?.published ?? true} />
        {f && <DeleteToggle />}
      </div>
    </>
  );
  return (
    <div className="space-y-4">
      {rows.map((f) => <Panel key={f.id}><AdminForm action={saveFaq}>{fields(f)}</AdminForm></Panel>)}
      <Panel title="Add a question"><AdminForm action={saveFaq} submitLabel="Add" resetOnSuccess>{fields()}</AdminForm></Panel>
    </div>
  );
}

async function Pages() {
  const rows = await db().query.pages.findMany({ orderBy: [asc(schema.pages.kind), asc(schema.pages.title)] });
  const fields = (p?: (typeof rows)[number]) => {
    const k = p?.id ?? "new";
    return (
      <>
        {p && <input type="hidden" name="id" value={p.id} />}
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">Type
            <Select id={`kind-${k}`} name="kind" defaultValue={p?.kind ?? "policy"} className="mt-1 py-2">
              <option value="policy">Policy (shown in footer)</option>
              <option value="about">About page</option>
            </Select>
          </label>
          <label className="text-sm">Title<Input id={`t-${k}`} name="title" defaultValue={p?.title} className="mt-1 py-2" /></label>
          <label className="text-sm">Slug<Input id={`s-${k}`} name="slug" defaultValue={p?.slug} placeholder="auto" className="mt-1 py-2" /></label>
        </div>
        <label className="block text-sm">Text <span className="text-ink-muted">— separate paragraphs with a blank line</span><Textarea id={`b-${k}`} name="body" defaultValue={p?.body} rows={8} className="mt-1" /></label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">Search title<Input id={`st-${k}`} name="seoTitle" defaultValue={p?.seoTitle ?? ""} className="mt-1 py-2" /></label>
          <label className="text-sm">Search description<Input id={`sd-${k}`} name="seoDescription" defaultValue={p?.seoDescription ?? ""} className="mt-1 py-2" /></label>
        </div>
        <div className="flex gap-6"><Check name="published" label="Published" defaultChecked={p?.published ?? true} />{p && <DeleteToggle />}</div>
      </>
    );
  };
  return (
    <div className="space-y-4">
      {rows.map((p) => <Panel key={p.id} title={p.kind === "about" ? "About page" : `/policies/${p.slug}`}><AdminForm action={savePage}>{fields(p)}</AdminForm></Panel>)}
      <Panel title="Add a page"><AdminForm action={savePage} submitLabel="Add page" resetOnSuccess>{fields()}</AdminForm></Panel>
    </div>
  );
}

async function Gallery() {
  const rows = await db().query.galleryItems.findMany({ orderBy: [asc(schema.galleryItems.sortOrder)] });
  const meta = (g?: (typeof rows)[number]) => {
    const k = g?.id ?? "new";
    return (
      <>
        <label className="block text-sm">Alt text<Input id={`alt-${k}`} name="alt" defaultValue={g?.alt} placeholder="Describe what the photo shows" className="mt-1 py-2" /></label>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">Caption<Input id={`cap-${k}`} name="caption" defaultValue={g?.caption ?? ""} className="mt-1 py-2" /></label>
          <label className="text-sm">Collection<Input id={`col-${k}`} name="collection" defaultValue={g?.collection ?? ""} placeholder="e.g. Weddings" className="mt-1 py-2" /></label>
          <label className="text-sm">Order<Input id={`ord-${k}`} name="sortOrder" defaultValue={g?.sortOrder ?? 0} inputMode="numeric" className="mt-1 py-2" /></label>
        </div>
        <div className="flex flex-wrap gap-6">
          <Check name="published" label="Published" defaultChecked={g?.published ?? true} />
          <Check name="featured" label="Featured" defaultChecked={g?.featured} />
          {g && <DeleteToggle />}
        </div>
      </>
    );
  };
  return (
    <div className="space-y-4">
      <Panel title="Add a photo">
        <AdminForm action={saveGalleryItem} submitLabel="Upload" encType="multipart/form-data" resetOnSuccess>
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Photo file" className="block text-sm" />
          {meta()}
        </AdminForm>
      </Panel>
      <ul className="grid gap-4 lg:grid-cols-2">
        {rows.map((g) => (
          <li key={g.id}>
            <Panel className="flex gap-4">
              <div className="relative size-28 shrink-0 overflow-hidden rounded-lg bg-blush"><Image src={g.src} alt={g.alt} fill sizes="112px" className="object-cover" /></div>
              <AdminForm action={saveGalleryItem} className="flex-1 space-y-3"><input type="hidden" name="id" value={g.id} />{meta(g)}</AdminForm>
            </Panel>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function Testimonials() {
  const rows = await db().query.testimonials.findMany({ orderBy: [asc(schema.testimonials.sortOrder)] });
  const fields = (t?: (typeof rows)[number]) => {
    const k = t?.id ?? "new";
    return (
      <>
        {t && <input type="hidden" name="id" value={t.id} />}
        <label className="block text-sm">Quote<Textarea id={`qt-${k}`} name="quote" defaultValue={t?.quote} rows={3} className="mt-1" /></label>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">Name<Input id={`au-${k}`} name="author" defaultValue={t?.author} className="mt-1 py-2" /></label>
          <label className="text-sm">Context<Input id={`cx-${k}`} name="context" defaultValue={t?.context ?? ""} placeholder="e.g. Wedding cake" className="mt-1 py-2" /></label>
          <label className="text-sm">Order<Input id={`so-${k}`} name="sortOrder" defaultValue={t?.sortOrder ?? 0} inputMode="numeric" className="mt-1 py-2" /></label>
        </div>
        <div className="flex flex-wrap gap-6">
          <Check name="verified" label="I've verified this is a genuine customer review and I may publish it" defaultChecked={t?.verified} />
          <Check name="published" label="Published" defaultChecked={t?.published} />
          {t && <DeleteToggle />}
        </div>
      </>
    );
  };
  return (
    <div className="space-y-4">
      {rows.map((t) => <Panel key={t.id}><AdminForm action={saveTestimonial}>{fields(t)}</AdminForm></Panel>)}
      <Panel title="Add a testimonial"><AdminForm action={saveTestimonial} submitLabel="Add" resetOnSuccess>{fields()}</AdminForm></Panel>
    </div>
  );
}
