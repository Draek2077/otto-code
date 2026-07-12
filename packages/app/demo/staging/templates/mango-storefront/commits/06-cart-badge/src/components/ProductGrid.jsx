import ProductCard from "./ProductCard.jsx";

export default function ProductGrid({ products, onAddToCart }) {
  return (
    <section className="product-grid" id="shop">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />
      ))}
    </section>
  );
}
