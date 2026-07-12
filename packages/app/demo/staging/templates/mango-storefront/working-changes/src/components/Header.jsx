export default function Header({ cartCount, query, onQueryChange }) {
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
      <input
        className="search-input"
        type="search"
        placeholder="Search the shop…"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        aria-label="Search products"
      />
      <button className="cart-button" type="button" aria-label={`Cart, ${cartCount} items`}>
        🛒{cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
      </button>
    </header>
  );
}
