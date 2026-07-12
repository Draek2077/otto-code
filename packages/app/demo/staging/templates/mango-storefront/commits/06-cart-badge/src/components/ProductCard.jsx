export default function ProductCard({ product, onAddToCart }) {
  return (
    <article className="product-card">
      <div className="product-visual" aria-hidden="true">
        {product.emoji}
      </div>
      <div className="product-info">
        <h3 className="product-name">{product.name}</h3>
        <p className="product-blurb">{product.blurb}</p>
        <div className="product-row">
          <span className="product-price">${product.price}</span>
          <button className="add-button" type="button" onClick={onAddToCart}>
            Add to cart
          </button>
        </div>
      </div>
    </article>
  );
}
