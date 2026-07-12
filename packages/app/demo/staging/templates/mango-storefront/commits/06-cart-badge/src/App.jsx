import { useState } from "react";
import Header from "./components/Header.jsx";
import Hero from "./components/Hero.jsx";
import ProductGrid from "./components/ProductGrid.jsx";
import { products } from "./data/products.js";

export default function App() {
  const [cartCount, setCartCount] = useState(0);

  function handleAddToCart() {
    setCartCount((count) => count + 1);
  }

  return (
    <>
      <Header cartCount={cartCount} />
      <main>
        <Hero />
        <ProductGrid products={products} onAddToCart={handleAddToCart} />
      </main>
    </>
  );
}
