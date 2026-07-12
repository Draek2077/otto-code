import Header from "./components/Header.jsx";
import Hero from "./components/Hero.jsx";
import ProductGrid from "./components/ProductGrid.jsx";
import { products } from "./data/products.js";

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <ProductGrid products={products} />
      </main>
    </>
  );
}
