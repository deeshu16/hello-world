import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  rating: number;
  status: 'In Stock' | 'Low Stock' | 'Out of Stock';
}

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly base = 'http://localhost:8080/api/products';

  constructor(private http: HttpClient) {}

  getProducts(): Observable<Product[]> {
    return this.http.get<Product[]>(this.base);
  }

  getProductImage(id: number): Observable<string> {
    return this.http
      .get(`${this.base}/${id}/image`, { responseType: 'blob' })
      .pipe(map(blob => URL.createObjectURL(blob)));
  }
}
