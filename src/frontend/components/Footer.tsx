import Link from "next/link";

const footerLinks = [
  { text: "About us", href: "/about" },
  { text: "Terms of Use", href: "/terms" },
  { text: "Donations", href: "/donations" },
];

export function Footer() {
  return (
    <footer className="@absolute @bottom-0 @left-0 @flex @w-full @flex-col @items-center @justify-center @gap-2 @border-t @border-white/5 @bg-bg-primary/50 @px-4 @backdrop-blur-sm">
      {/* Thin tactical accent rule — a light touch of primary instead of the old heavy slab. */}
      <span className="@h-px @w-16 @bg-gradient-to-r @from-transparent @via-primary/50 @to-transparent" />

      <nav className="@flex @items-center @gap-4 @font-russoOne @text-[11px] @uppercase @tracking-[0.18em] smallscreen:@gap-5 smallscreen:@text-xs">
        {footerLinks.map((item, index) => (
          <div key={item.text} className="@flex @items-center @gap-4 smallscreen:@gap-5">
            {index > 0 && <span aria-hidden className="@h-3 @w-px @bg-white/10" />}
            <Link
              href={item.href}
              className="@text-slate-400 @transition-colors @duration-200 hover:@text-primary"
            >
              {item.text}
            </Link>
          </div>
        ))}
      </nav>

      <p className="@m-0 @text-center @text-[10px] @leading-relaxed @text-slate-600">
        Advance Wars © Nintendo / Intelligent Systems. Images © their respective owners.
      </p>
    </footer>
  );
}
