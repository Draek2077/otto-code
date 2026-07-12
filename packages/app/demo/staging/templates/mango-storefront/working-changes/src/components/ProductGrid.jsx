import ProductCard from "./ProductCard.jsx";

export default function ProductGrid({ products, onAddToCart }) {
  if (products.length === 0) {
    return <p className="grid-empty">Nothing matches your search — try a different word.</p>;
  }

  return (
    <section className="product-grid" id="shop">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />
      ))}
    </section>
  );
}
