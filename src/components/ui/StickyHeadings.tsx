"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

export type StickyHeadingMode = "auto" | "always" | false;
type Section = { root: HTMLElement; heading: HTMLElement; trigger: HTMLElement; clip: HTMLElement | null };
type FloatingHeading = Section & { top: number; left: number; width: number; title: string; link: HTMLAnchorElement | null };
const open = (root: HTMLElement) => root instanceof HTMLDetailsElement ? root.open : root.dataset.stickyOpen === "true";
const visible = (element: HTMLElement) => element.checkVisibility({ checkVisibilityCSS: true });
const headingFor = (root: HTMLElement) => root.querySelector<HTMLElement>(":scope > summary, :scope > [data-sticky-heading-control]");
const clippedBy = (heading: HTMLElement, scope: HTMLElement) => {
  for (let parent = heading.parentElement; parent && parent !== scope; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if ([style.overflowX, style.overflowY].some(value => /^(auto|scroll|hidden)$/.test(value))) return parent;
  }
  return null;
};
const returnControl = (section: Section) => section.root.dataset.stickyReturnTo ? document.getElementById(section.root.dataset.stickyReturnTo) : section.trigger;

/** Workspace-only coordination: native disclosures and marked cards share one visible heading. */
export function StickyHeadings({ scopeRef }: { scopeRef: RefObject<HTMLDivElement | null> }) {
  const [floating, setFloating] = useState<FloatingHeading | null>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<Section | null>(null);
  const focusOverlayRef = useRef<"a" | "button" | false>(false);
  const collapseRef = useRef<(section: Section) => void>(() => {});

  useLayoutEffect(() => {
    if (floating && focusOverlayRef.current) {
      floatingRef.current?.querySelector<HTMLElement>(focusOverlayRef.current)?.focus({ preventScroll: true });
      focusOverlayRef.current = false;
    }
  }, [floating]);

  useEffect(() => {
    const scope = scopeRef.current;
    const workspace = scope?.querySelector<HTMLElement>(".workspace-content");
    const masthead = scope?.querySelector<HTMLElement>(".masthead");
    if (!scope || !workspace || !masthead) return;
    let frame = 0, dirty = true, sections: Section[] = [], covered: Section | null = null;
    let savedAria: string | null = null, savedInert = false;
    const observed = new Set<Element>();
    const resize = new ResizeObserver(() => schedule());
    const observe = (elements: Element[]) => {
      const next = new Set(elements);
      for (const element of observed) if (!next.has(element)) { resize.unobserve(element); observed.delete(element); }
      for (const element of next) if (!observed.has(element)) { observed.add(element); resize.observe(element); }
    };
    const chrome = () => {
      const viewport = window.visualViewport;
      const bannerTop = Math.max(viewport?.offsetTop || 0, masthead.getBoundingClientRect().bottom) + 8;
      scope.style.setProperty("--workspace-banner-top", `${bannerTop}px`);
      const archive = workspace.querySelector<HTMLElement>(".archive-activity");
      const rect = archive && visible(archive) ? archive.getBoundingClientRect() : null;
      const top = rect && rect.top < (viewport?.height || innerHeight) && rect.bottom > bannerTop ? Math.max(bannerTop, rect.bottom + 8) : bannerTop;
      scope.style.setProperty("--workspace-sticky-top", `${top}px`);
      return { top, height: viewport?.height || innerHeight, viewportTop: viewport?.offsetTop || 0, bottom: (viewport?.offsetTop || 0) + (viewport?.height || innerHeight), archive };
    };
    const uncover = () => {
      if (!covered) return;
      const heading = covered.heading;
      const hadFocus = !!floatingRef.current?.contains(document.activeElement);
      delete heading.dataset.stickyCovered;
      if (savedAria === null) heading.removeAttribute("aria-hidden"); else heading.setAttribute("aria-hidden", savedAria);
      heading.inert = savedInert;
      if (hadFocus && heading.isConnected) {
        const linkFocused = document.activeElement instanceof Element && !!document.activeElement.closest("a");
        (linkFocused ? heading.querySelector<HTMLAnchorElement>("a[href]") || covered.trigger : covered.trigger).focus({ preventScroll: true });
      }
      covered = null;
    };
    const restoreAfterCollapse = (section: Section) => {
      const destination = returnControl(section);
      requestAnimationFrame(() => {
        if (section.root.isConnected && open(section.root) || !destination?.isConnected) return;
        destination.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        const { top, bottom } = chrome(), rect = destination.getBoundingClientRect();
        if (rect.top < top || rect.bottom > bottom - 8) window.scrollBy({ top: rect.top - top, behavior: "instant" });
        destination.focus({ preventScroll: true });
        schedule();
      });
    };
    const update = () => {
      frame = 0;
      const { top, height, viewportTop, archive } = chrome();
      if (dirty) {
        for (const section of sections) { delete section.heading.dataset.stickyEligible; delete section.root.dataset.stickyPinned; }
        sections = Array.from(workspace.querySelectorAll<HTMLElement>("details, [data-sticky-heading]")).flatMap(root => {
          const heading = headingFor(root);
          const trigger = root instanceof HTMLDetailsElement ? heading : heading?.querySelector<HTMLElement>("[data-sticky-toggle]");
          return heading && trigger && !root.closest("dialog") ? [{ root, heading, trigger, clip: clippedBy(heading, scope) }] : [];
        });
        dirty = false;
      }
      observe([masthead, ...(archive ? [archive] : []), ...sections.flatMap(section => [section.root, section.heading]), ...(floatingRef.current ? [floatingRef.current] : [])]);
      const usableHeight = height - (top - viewportTop);
      const eligible = sections.filter(section => section.root.dataset.stickyHeading !== "off" && open(section.root) && visible(section.root) && section.heading.getBoundingClientRect().height < usableHeight - 64 && (section.root.dataset.stickyHeading === "always" || section.root.getBoundingClientRect().height > usableHeight - 16));
      const outer = eligible.filter(section => !eligible.some(parent => parent !== section && parent.root.contains(section.root)));
      let active: Section | null = null;
      for (const section of sections) {
        const enabled = outer.includes(section);
        section.heading.dataset.stickyEligible = String(enabled && !section.clip);
        const clipRect = section.clip?.getBoundingClientRect();
        const tableHead = section.clip?.querySelector<HTMLElement>(":scope > table > thead");
        const sectionTop = clipRect ? Math.max(top, clipRect.top + (tableHead?.getBoundingClientRect().height || 0) + 8) : top;
        section.root.dataset.stickyTop = String(sectionTop);
        const rect = section.root.getBoundingClientRect(), header = section.heading.getBoundingClientRect();
        const headingHeight = covered?.root === section.root && floatingRef.current ? floatingRef.current.getBoundingClientRect().height : header.height;
        const pinned = enabled && header.top <= sectionTop + 1 && rect.bottom > sectionTop + headingHeight && rect.top < sectionTop && (!clipRect || clipRect.bottom > sectionTop + headingHeight);
        section.root.dataset.stickyPinned = String(pinned);
        if (pinned) active = section;
        const toolbar = section.root.querySelector<HTMLElement>(".materials-toolbar");
        if (toolbar) toolbar.style.setProperty("--materials-sticky-top", `${top + (enabled && !section.clip ? header.height + 8 : 0)}px`);
        const headingOffset = enabled ? headingHeight + 8 : 0;
        const toolbarOffset = toolbar && visible(toolbar) ? toolbar.getBoundingClientRect().height + 8 : 0;
        section.root.style.setProperty("--section-scroll-offset", `${top + headingOffset + toolbarOffset}px`);
      }
      activeRef.current = active;
      if (!active?.clip) {
        uncover();
        setFloating(current => current === null ? current : null);
        return;
      }
      if (covered?.root !== active.root) {
        uncover();
        covered = active;
        savedAria = active.heading.getAttribute("aria-hidden"); savedInert = active.heading.inert;
        focusOverlayRef.current = active.heading.contains(document.activeElement) ? document.activeElement instanceof Element && document.activeElement.closest("a") ? "a" : "button" : false;
        active.heading.dataset.stickyCovered = "true";
        active.heading.setAttribute("aria-hidden", "true"); active.heading.inert = true;
      }
      const rect = active.root.getBoundingClientRect(), clip = active.clip.getBoundingClientRect();
      const left = Math.max(8, rect.left, clip.left), right = Math.min(innerWidth - 8, rect.right, clip.right);
      if (right <= left) { uncover(); setFloating(null); return; }
      const next: FloatingHeading = { ...active, top: Number(active.root.dataset.stickyTop) || top, left, width: right - left, title: active.root.dataset.stickyTitle || active.heading.textContent?.trim() || "Expanded section", link: active.heading.querySelector<HTMLAnchorElement>("a[href]") };
      setFloating(current => current?.root === next.root && current.top === next.top && current.left === next.left && current.width === next.width && current.title === next.title && current.link === next.link ? current : next);
    };
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    const mutate = () => { dirty = true; schedule(); };
    const mutations = new MutationObserver(mutate);
    mutations.observe(scope, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "hidden", "class", "data-sticky-open", "data-sticky-heading"] });
    const onClick = (event: Event) => {
      const section = activeRef.current;
      if (!section || !(event.target instanceof Element)) return;
      const target = event.target.closest("summary, [data-sticky-toggle]");
      if (target === section.trigger && open(section.root)) restoreAfterCollapse(section);
    };
    collapseRef.current = section => { uncover(); restoreAfterCollapse(section); section.trigger.click(); schedule(); };
    workspace.addEventListener("click", onClick, true);
    workspace.addEventListener("toggle", mutate, true);
    window.addEventListener("scroll", schedule, { passive: true });
    workspace.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame); mutations.disconnect(); resize.disconnect(); uncover();
      workspace.removeEventListener("click", onClick, true); workspace.removeEventListener("toggle", mutate, true);
      window.removeEventListener("scroll", schedule); workspace.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule);
      for (const section of sections) { delete section.heading.dataset.stickyEligible; delete section.root.dataset.stickyPinned; }
    };
  }, [scopeRef]);

  return floating ? createPortal(<div ref={floatingRef} className="sticky-heading-overlay" data-sticky-overlay style={{ top: floating.top, left: floating.left, width: floating.width }}>
    <strong title={floating.title}>{floating.title}</strong>
    <div className="button-row">{floating.link && <a className="text-link" href={floating.link.href} onClick={event => { event.preventDefault(); floating.link?.click(); }}>{floating.link.textContent}</a>}<button type="button" className="button secondary" aria-expanded="true" aria-controls={floating.trigger.getAttribute("aria-controls") || undefined} aria-label={`Collapse ${floating.title}`} onClick={() => collapseRef.current(floating)}>Collapse</button></div>
  </div>, document.body) : null;
}
