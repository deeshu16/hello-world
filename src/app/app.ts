import { Component, OnInit, OnDestroy, ViewChild, ElementRef, signal, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, from } from 'rxjs';
import { mergeMap, map, takeUntil } from 'rxjs/operators';
import { ProductService, Product } from './product.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private readonly IMAGE_CONCURRENCY = 5;
  private readonly PAGE_SIZE = 12;
  private destroy$ = new Subject<void>();
  private objectUrls: string[] = [];
  private observer?: IntersectionObserver;
  private sentinelEl?: HTMLElement;

  products = signal<Product[]>([]);
  productsLoading = signal(true);
  productsError = signal(false);
  visibleCount = signal(this.PAGE_SIZE);

  private _searchTerm = '';
  get searchTerm() { return this._searchTerm; }
  set searchTerm(val: string) {
    this._searchTerm = val;
    this.resetPagination();
  }

  private _selectedCategory = 'All';
  get selectedCategory() { return this._selectedCategory; }

  imageUrls = new Map<number, string>();
  loadedImages = new Set<number>();

  @ViewChild('scrollAnchor') set scrollAnchor(el: ElementRef) {
    if (el && !this.observer) {
      this.sentinelEl = el.nativeElement;
      this.observer = new IntersectionObserver(
        entries => { if (entries[0].isIntersecting) this.loadMore(); },
        { rootMargin: '200px' }
      );
      this.observer.observe(el.nativeElement);
    }
  }

  constructor(private productService: ProductService, private cdr: ChangeDetectorRef) {}

  get categories(): string[] {
    const cats = [...new Set(this.products().map(p => p.category))].sort();
    return ['All', ...cats];
  }

  get filtered(): Product[] {
    const term = this._searchTerm.toLowerCase();
    const cat = this._selectedCategory;
    return this.products().filter(
      p =>
        (cat === 'All' || p.category === cat) &&
        (p.name.toLowerCase().includes(term) || p.category.toLowerCase().includes(term))
    );
  }

  get visibleProducts(): Product[] {
    return this.filtered.slice(0, this.visibleCount());
  }

  get hasMore(): boolean {
    return this.visibleCount() < this.filtered.length;
  }

  selectCategory(cat: string) {
    this._selectedCategory = cat;
    this.resetPagination();
  }

  private resetPagination() {
    this.visibleCount.set(this.PAGE_SIZE);
    this.fetchImagesForVisible();
  }

  ngOnInit() {
    this.productService
      .getProducts()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: products => {
          this.products.set(products);
          this.productsLoading.set(false);
          this.fetchImagesForVisible();
        },
        error: () => {
          this.productsLoading.set(false);
          this.productsError.set(true);
        },
      });
  }

  loadMore() {
    if (!this.hasMore) return;
    const newCount = Math.min(this.visibleCount() + this.PAGE_SIZE, this.filtered.length);
    this.visibleCount.set(newCount);
    this.fetchImagesForVisible();
    this.cdr.detectChanges();
    // On large screens the sentinel may still be in the viewport after adding a page —
    // IntersectionObserver won't re-fire because the state didn't change, so keep
    // loading until the sentinel is pushed below the fold.
    if (this.hasMore && this.sentinelEl) {
      const rect = this.sentinelEl.getBoundingClientRect();
      if (rect.top < window.innerHeight) this.loadMore();
    }
  }

  private fetchImagesForVisible() {
    const toFetch = this.visibleProducts.filter(p => !this.imageUrls.has(p.id));
    if (toFetch.length > 0) this.fetchImages(toFetch);
  }

  private fetchImages(products: Product[]) {
    from(products)
      .pipe(
        mergeMap(
          p => this.productService.getProductImage(p.id).pipe(map(url => ({ id: p.id, url }))),
          this.IMAGE_CONCURRENCY
        ),
        takeUntil(this.destroy$)
      )
      .subscribe(({ id, url }) => {
        this.objectUrls.push(url);
        this.imageUrls.set(id, url);
        this.cdr.detectChanges();
      });
  }

  onImageLoad(id: number) {
    this.loadedImages.add(id);
  }

  onImageError(id: number) {
    this.loadedImages.add(id);
  }

  statusClass(status: string) {
    return {
      'badge-in-stock': status === 'In Stock',
      'badge-low-stock': status === 'Low Stock',
      'badge-out-of-stock': status === 'Out of Stock',
    };
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.observer?.disconnect();
  }
}
