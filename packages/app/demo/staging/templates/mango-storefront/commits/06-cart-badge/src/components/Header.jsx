export default function Header({ cartCount }) {
  return (
    <header className="site-header">
      <a className="logo" href="/">
        <span className="logo-mark">🥭</span> Mango Threads
      </a>
      <nav className="site-nav">
        <a href="#new">New in</a>
        <a href="#tops">Tops</a>
        <a href="#accessories">Accessories</a>
        <a href="#sale">Sale</a>
      </nav>
      <button className="cart-button" type="button" aria-label={`Cart, ${cartCount} items`}>
        🛒{cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
      </button>
    </header>
  );
}
