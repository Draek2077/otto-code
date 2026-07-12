import "./checkout.css";

/** Checkout page stub — not routed into the app yet. */
export default function Checkout({ cartCount }) {
  return (
    <section className="checkout">
      <h2 className="checkout-title">Checkout</h2>
      <p className="checkout-note">
        {cartCount} {cartCount === 1 ? "item" : "items"} in your bag
      </p>
      <p className="checkout-note">Shipping and payment form coming next.</p>
    </section>
  );
}
