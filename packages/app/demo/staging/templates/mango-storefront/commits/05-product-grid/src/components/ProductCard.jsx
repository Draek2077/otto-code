export default function ProductCard({ product }) {
  return (
    <article className="product-card">
      <div className="product-visual" aria-hidden="true">
        {product.emoji}
      </div>
      <div className="product-info">
        <h3 className="product-name">{product.name}</h3>
        <p className="product-blurb">{product.blurb}</p>
        <span className="product-price">${product.price}</span>
      </div>
    </article>
  );
}
