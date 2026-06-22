const header = document.querySelector("[data-header]");
const nav = document.querySelector("[data-nav]");
const navToggle = document.querySelector("[data-nav-toggle]");
const revealItems = document.querySelectorAll(".reveal");

const currentPage = window.location.pathname.split("/").pop() || "index.html";
document.querySelectorAll(".site-nav a").forEach((link) => {
  const href = link.getAttribute("href").split("#")[0];
  if (href && href === currentPage) {
    link.setAttribute("aria-current", "page");
  }
});

const updateHeader = () => {
  header.classList.toggle("is-scrolled", window.scrollY > 12);
};

navToggle.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

nav.addEventListener("click", (event) => {
  if (event.target.tagName === "A") {
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("click", (event) => {
  if (
    nav.classList.contains("is-open") &&
    !nav.contains(event.target) &&
    !navToggle.contains(event.target)
  ) {
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  }
});

const contactForm = document.getElementById("contact-form");
if (contactForm) {
  contactForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(contactForm);
    const body = [...data.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    window.location.href = `mailto:chho@chho.com.tw?subject=網站詢問&body=${encodeURIComponent(body)}`;
  });
}

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.14 }
);

revealItems.forEach((item) => revealObserver.observe(item));
window.addEventListener("scroll", updateHeader, { passive: true });
updateHeader();

const metricNumbers = document.querySelectorAll(".metrics strong");
const countObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const raw = el.textContent.trim();
      const num = parseInt(raw, 10);
      const suffix = raw.slice(String(num).length);
      const duration = 1400;
      const startTime = performance.now();
      const tick = (now) => {
        const t = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(eased * num) + suffix;
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      countObserver.unobserve(el);
    });
  },
  { threshold: 0.8 }
);

metricNumbers.forEach((n) => countObserver.observe(n));
