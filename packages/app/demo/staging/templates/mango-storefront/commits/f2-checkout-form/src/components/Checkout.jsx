import "./checkout.css";

/** Checkout page — form fields in place, submit wiring lands with the payments API. */
export default function Checkout({ cartCount }) {
  function handleSubmit(event) {
    event.preventDefault();
  }

  return (
    <section className="checkout">
      <h2 className="checkout-title">Checkout</h2>
      <p className="checkout-note">
        {cartCount} {cartCount === 1 ? "item" : "items"} in your bag
      </p>
      <form className="checkout-form" onSubmit={handleSubmit}>
        <label>
          Email
          <input type="email" name="email" placeholder="you@example.com" required />
        </label>
        <label>
          Shipping address
          <input type="text" name="address" placeholder="12 Grove Lane" required />
        </label>
        <div className="checkout-row">
          <label>
            City
            <input type="text" name="city" required />
          </label>
          <label>
            Postal code
            <input type="text" name="postal" inputMode="numeric" required />
          </label>
        </div>
        <button className="checkout-submit" type="submit">
          Continue to payment
        </button>
      </form>
    </section>
  );
}
