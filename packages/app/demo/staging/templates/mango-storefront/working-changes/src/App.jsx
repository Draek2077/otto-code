import { useMemo, useState } from "react";
import Header from "./components/Header.jsx";
import Hero from "./components/Hero.jsx";
import ProductGrid from "./components/ProductGrid.jsx";
import Footer from "./components/Footer.jsx";
import { products } from "./data/products.js";

export default function App() {
  const [cartCount, setCartCount] = useState(0);
  const [query, setQuery] = useState("");

  const visibleProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") {
      return products;
    }
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(needle) || product.blurb.toLowerCase().includes(needle),
    );
  }, [query]);

  function handleAddToCart() {
    setCartCount((count) => count + 1);
  }

  return (
    <>
      <Header cartCount={cartCount} query={query} onQueryChange={setQuery} />
      <main>
        <Hero />
        <ProductGrid products={visibleProducts} onAddToCart={handleAddToCart} />
      </main>
      <Footer />
    </>
  );
}
