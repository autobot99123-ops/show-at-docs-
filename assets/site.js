/* ShowAt Docs — progressive enhancement only. Every page works without JS. */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Docs order (single source for prev/next). Slugs map to docs/<slug>.html */
  var ORDER = [
    "introduction",
    "what-is-showat",
    "how-showat-works",
    "profile",
    "techy",
    "connected-accounts",
    "projects",
    "project-progress",
    "milestones",
    "community",
    "tools",
    "resources",
    "messages",
    "faq",
    "troubleshooting"
  ];

  var TITLES = {
    introduction: "Introduction",
    "what-is-showat": "What is ShowAt?",
    "how-showat-works": "How ShowAt Works",
    profile: "Profile",
    techy: "Techy",
    "connected-accounts": "Connected Accounts",
    projects: "Projects",
    "project-progress": "Project Progress",
    milestones: "Milestones",
    community: "Community",
    tools: "Tools",
    resources: "Resources",
    messages: "Messages",
    faq: "FAQ",
    troubleshooting: "Troubleshooting"
  };

  function currentSlug() {
    var file = window.location.pathname.split("/").pop() || "index.html";
    return file.replace(/\.html$/, "");
  }

  /* Header + sidebar active states (static markup carries the links). */
  function markActive() {
    var path = window.location.pathname;
    var slug = currentSlug();
    var inDocs = path.indexOf("/docs") !== -1 || ORDER.indexOf(slug) !== -1;
    document.querySelectorAll(".site-nav a[data-nav]").forEach(function (a) {
      var key = a.getAttribute("data-nav");
      var active =
        (key === "docs" && inDocs) ||
        (key === "download" && slug === "download") ||
        (key === "home" && !inDocs && slug !== "download");
      if (active) {
        a.setAttribute("aria-current", "page");
      }
    });
    document.querySelectorAll(".sidebar a[data-slug]").forEach(function (a) {
      if (a.getAttribute("data-slug") === slug) {
        a.setAttribute("aria-current", "page");
      }
    });
  }

  /* Previous / next article navigation. */
  function prevNext() {
    var mount = document.querySelector("[data-prev-next]");
    if (!mount) {
      return;
    }
    var slug = currentSlug();
    var i = ORDER.indexOf(slug);
    if (i === -1) {
      return;
    }
    var html = "";
    if (i > 0) {
      html +=
        '<a class="prev" href="' +
        ORDER[i - 1] +
        '.html"><span>Previous</span><strong>' +
        TITLES[ORDER[i - 1]] +
        "</strong></a>";
    } else {
      html += "<span></span>";
    }
    if (i < ORDER.length - 1) {
      html +=
        '<a class="next" href="' +
        ORDER[i + 1] +
        '.html"><span>Next</span><strong>' +
        TITLES[ORDER[i + 1]] +
        "</strong></a>";
    }
    mount.innerHTML = html;
  }

  /* Right table of contents from article h2s. */
  function toc() {
    var list = document.querySelector("[data-toc-list]");
    var article = document.querySelector("[data-article]");
    if (!list || !article) {
      return;
    }
    var heads = article.querySelectorAll("h2[id]");
    if (!heads.length) {
      var toc = document.querySelector("[data-toc]");
      if (toc) {
        toc.hidden = true;
      }
      return;
    }
    var html = "";
    heads.forEach(function (h) {
      html += '<li><a href="#' + h.id + '">' + h.textContent + "</a></li>";
    });
    list.innerHTML = html;
    if (!reduceMotion && "IntersectionObserver" in window) {
      var links = Array.prototype.slice.call(list.querySelectorAll("a"));
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              links.forEach(function (a) {
                a.classList.toggle("active", a.getAttribute("href") === "#" + entry.target.id);
              });
            }
          });
        },
        { rootMargin: "-30% 0px -60% 0px" }
      );
      heads.forEach(function (h) {
        observer.observe(h);
      });
    }
  }

  /* Section reveal. */
  function reveal() {
    var items = document.querySelectorAll(".reveal");
    if (!items.length) {
      return;
    }
    if (reduceMotion || !("IntersectionObserver" in window)) {
      items.forEach(function (el) {
        el.classList.add("visible");
      });
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    items.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* Mobile docs menu. */
  function menu() {
    var button = document.querySelector("[data-menu-button]");
    var sidebar = document.querySelector(".sidebar");
    if (!button || !sidebar) {
      return;
    }
    function close() {
      document.body.classList.remove("nav-open");
      button.setAttribute("aria-expanded", "false");
      var scrim = document.querySelector(".nav-scrim");
      if (scrim) {
        scrim.remove();
      }
    }
    button.addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      button.setAttribute("aria-expanded", String(open));
      if (open) {
        var scrim = document.createElement("button");
        scrim.className = "nav-scrim";
        scrim.setAttribute("aria-label", "Close documentation menu");
        scrim.setAttribute("tabindex", "-1");
        scrim.addEventListener("click", close);
        document.body.appendChild(scrim);
      } else {
        close();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        close();
      }
    });
    sidebar.addEventListener("click", function (event) {
      if (event.target.closest("a")) {
        close();
      }
    });
  }

  /* Release facts (static fallback text is already in the HTML). */
  function config() {
    var site = window.SHOWAT_SITE;
    if (!site) {
      return;
    }
    document.querySelectorAll("[data-config]").forEach(function (el) {
      var key = el.getAttribute("data-config");
      if (site[key] !== undefined) {
        el.textContent = String(site[key]);
      }
    });
  }

  function year() {
    document.querySelectorAll("[data-year]").forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  markActive();
  prevNext();
  toc();
  reveal();
  menu();
  config();
  year();
})();
