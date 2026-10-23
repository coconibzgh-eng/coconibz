const menuToggle = document.querySelector(".menu-toggle");
const navMenu = document.querySelector("#primary-menu");
const siteHeader = document.querySelector(".site-header");

menuToggle.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Open navigation menu" : "Close navigation menu");
  navMenu.classList.toggle("is-open", !isOpen);
  document.body.classList.toggle("menu-open", !isOpen);
});

navMenu.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation menu");
    navMenu.classList.remove("is-open");
    document.body.classList.remove("menu-open");
  });
});

window.addEventListener("scroll", () => {
  siteHeader.classList.toggle("is-scrolled", window.scrollY > 12);
}, { passive: true });

document.querySelector("#current-year").textContent = String(new Date().getFullYear());
