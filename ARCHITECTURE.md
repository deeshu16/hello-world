# App Architecture & Logic Explanation

Here's a complete walkthrough of how the app works, from boot to scroll.

---

## 1. Bootstrap & Data Flow

When the app starts, `ngOnInit` fires and calls `productService.getProducts()` — a single HTTP GET to `localhost:8080/api/products` that returns the full product list.

```
HTTP GET /api/products
       ↓
products signal ← full array (e.g. 100 items)
productsLoading signal ← false   (triggers template to render)
fetchImagesForVisible()           (only fetches images for first 12)
```

`products` is an Angular **signal** — a reactive value. Setting it via `.set()` tells Angular's change detection that something changed and the template needs to re-render.

---

## 2. Signals Used as State

```typescript
products = signal<Product[]>([]);      // full dataset from API
productsLoading = signal(true);        // controls loading spinner
productsError = signal(false);         // controls error message
visibleCount = signal(this.PAGE_SIZE); // how many cards to render (starts at 12)
```

Signals are read with `()` in both TypeScript (`this.products()`) and the template (`products()`). When a signal value changes, Angular re-evaluates any template expression that reads it.

---

## 3. Computed Getters (derived state)

These are plain TypeScript getters — not signals — but they're re-evaluated on every change detection cycle.

```typescript
get filtered(): Product[]
```
Filters the full `products` array by the current search term and selected category. Reads `this._searchTerm`, `this._selectedCategory`, and `this.products()`.

```typescript
get visibleProducts(): Product[]
```
Slices `filtered` down to only what should render:
```
filtered = [p1, p2, ..., p100]   (after search/category filter)
visibleProducts = filtered.slice(0, visibleCount())  → first 12
```

```typescript
get hasMore(): boolean
```
`true` when `visibleCount() < filtered.length` — drives the loading spinner vs. "all shown" message at the bottom.

```typescript
get categories(): string[]
```
Extracts unique category names from all products for the filter buttons.

---

## 4. Search & Category — Reset on Change

`searchTerm` is a **getter/setter** instead of a plain property, specifically so changing it also resets pagination:

```typescript
set searchTerm(val: string) {
  this._searchTerm = val;
  this.resetPagination();   // ← side effect
}
```

`[(ngModel)]="searchTerm"` in the template calls the setter on every keystroke. Same pattern for category — clicking a filter button calls `selectCategory(cat)` which sets `_selectedCategory` and calls `resetPagination()`.

`resetPagination()` does two things:
1. Resets `visibleCount` back to 12 (so you start from the top of the new filtered list)
2. Calls `fetchImagesForVisible()` to load images for the new first page

---

## 5. Image Fetching — Only What's Visible

```typescript
private fetchImagesForVisible() {
  const toFetch = this.visibleProducts.filter(p => !this.imageUrls.has(p.id));
  if (toFetch.length > 0) this.fetchImages(toFetch);
}
```

This is the key optimization. It only fetches images for products that are:
- Currently in `visibleProducts` (i.e., rendered on screen)
- **AND** not already in `imageUrls` (the cache map)

So if you search, filter, then clear the search — images already fetched are never re-requested.

`fetchImages()` uses RxJS `from()` + `mergeMap` with a concurrency of 5 — at most 5 image HTTP requests fly in parallel at a time:

```
products array → observable stream
     ↓ mergeMap(concurrency=5)
[req1, req2, req3, req4, req5] in parallel
     ↓ as each resolves:
imageUrls.set(id, objectUrl)   ← blob URL stored in the Map
cdr.detectChanges()            ← force template to re-render that card
```

Each image response is a binary blob. `URL.createObjectURL(blob)` converts it to a local `blob://` URL that the `<img>` tag can use. These URLs are collected in `objectUrls[]` so they can be revoked on destroy (prevents memory leaks).

---

## 6. Infinite Scroll via IntersectionObserver

```typescript
@ViewChild('scrollAnchor') set scrollAnchor(el: ElementRef) {
  if (el && !this.observer) {
    this.observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) this.loadMore(); },
      { rootMargin: '200px' }
    );
    this.observer.observe(el.nativeElement);
  }
}
```

`@ViewChild` with a **setter** instead of a property — this fires automatically when the `#scrollAnchor` div appears in the DOM (which happens the moment products finish loading and the `@else` block renders). It sets up the observer exactly once (`!this.observer` guard).

`rootMargin: '200px'` means the callback fires when the sentinel is within 200px of the viewport bottom — slightly before the user actually hits the end, so new cards appear seamlessly.

`loadMore()` flow:
```
IntersectionObserver fires
       ↓
hasMore check (exit if all shown)
       ↓
visibleCount.set(current + 12)    ← expand the visible slice
fetchImagesForVisible()           ← fetch images for the 12 new cards
cdr.detectChanges()               ← render the new cards immediately
```

---

## 7. Card Rendering & Image Reveal

Each card has two layers inside `.image-wrapper`:

```
.image-skeleton   ← shimmer animation, always present
.product-image    ← actual <img>, opacity: 0 initially
```

The `@if (imageUrls.has(product.id))` block only adds the `<img>` tag to the DOM once the blob URL is ready. When the browser finishes rendering it, `(load)` fires → `onImageLoad(id)` → adds id to `loadedImages` set → `[class.visible]` becomes true → CSS `opacity: 1` with a 0.4s fade. The skeleton simultaneously gets `[class.hidden]` → `opacity: 0`.

---

## 8. Cleanup

```typescript
ngOnDestroy() {
  this.destroy$.next();          // cancels all active HTTP requests (takeUntil)
  this.destroy$.complete();
  this.objectUrls.forEach(url => URL.revokeObjectURL(url));  // free blob memory
  this.observer?.disconnect();   // stop watching the sentinel
}
```

`takeUntil(this.destroy$)` is the RxJS pattern that ties all subscriptions to the component lifetime — when `destroy$.next()` fires, every active observable (including in-flight image fetches) is cancelled automatically.

---

## Summary Flow Diagram

```
App starts
  └─ getProducts() ──────────────────────────────► products signal set
                                                      └─ fetchImagesForVisible()
                                                           └─ fetch images 1–12 (5 at a time)
                                                                └─ imageUrls Map fills in
                                                                     └─ cdr.detectChanges() per image

User scrolls down
  └─ IntersectionObserver fires (sentinel 200px away)
       └─ loadMore()
            ├─ visibleCount 12 → 24
            └─ fetchImagesForVisible() → fetch images 13–24 only

User types in search
  └─ searchTerm setter
       ├─ visibleCount reset to 12
       └─ fetchImagesForVisible() → fetch images for new top-12 (skip already cached)
```
