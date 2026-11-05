(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    faq: [],
    adminToken: sessionStorage.getItem("savro_support_admin_token") || "",
    tickets: [],
    selectedTicket: null,
    customerCode: null,
    customerToken: null
  };

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

  const formatDate = value => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" :
      date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  };

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (state.adminToken && !headers.Authorization) {
      headers.Authorization = `Bearer ${state.adminToken}`;
    }

    let response;
    try {
      const supportUrl = url.startsWith("/api/") ? "/api/support" + url.slice(4) : url;
      response = await fetch(supportUrl, { ...options, headers });
    } catch {
      throw new Error("Could not connect to Savro Support. Check your internet connection and try again.");
    }

    let data = {};
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try { data = await response.json(); } catch { data = {}; }
    } else {
      try { data.message = await response.text(); } catch { data = {}; }
    }

    if (!response.ok) {
      throw new Error(data.error || data.message || `Request failed (${response.status}). Please try again.`);
    }
    return data;
  }

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function showView(name, updateUrl = true) {
    const allowed = ["home", "ticket", "admin", "track"];
    const target = allowed.includes(name) ? name : "home";
    const section = $(`#${target}View`);
    if (!section) return;

    $$(".view").forEach(item => item.classList.add("hidden"));
    section.classList.remove("hidden");

    if (target === "home") loadFaq();
    if (target === "admin") initAdmin();

    if (updateUrl) {
      const hash = target === "home" ? "" : `#${target}`;
      history.replaceState(null, "", `${location.pathname}${hash}`);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  // Delegated navigation keeps header, hero and footer links working consistently.
  document.addEventListener("click", event => {
    const nav = event.target.closest("[data-view]");
    if (nav) {
      event.preventDefault();
      showView(nav.dataset.view);
      return;
    }

    const category = event.target.closest("[data-cat]");
    if (category) {
      const search = $("#faqSearch");
      if (search) {
        search.value = category.dataset.cat || "";
        renderFaq();
        $("#faqList")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }

    const question = event.target.closest(".question");
    if (question) {
      const answer = question.nextElementSibling;
      if (answer) {
        answer.classList.toggle("hidden");
        const symbol = $("b", question);
        if (symbol) symbol.textContent = answer.classList.contains("hidden") ? "+" : "−";
      }
    }
  });

  async function loadFaq() {
    const list = $("#faqList");
    if (!list) return;
    try {
      const result = await api("/api/faq");
      state.faq = Array.isArray(result.items) ? result.items : [];
      const categories = [...new Set(state.faq.map(item => item.category).filter(Boolean))];
      const categoryBox = $("#categories");
      if (categoryBox) {
        categoryBox.innerHTML = categories.map(category => {
          const count = state.faq.filter(item => item.category === category).length;
          return `<button type="button" class="cat" data-cat="${escapeHtml(category)}">
            <i aria-hidden="true">✦</i><span><strong>${escapeHtml(category)}</strong>${count} helpful articles</span>
          </button>`;
        }).join("");
      }
      renderFaq();
    } catch (error) {
      list.textContent = error.message || "Help articles are temporarily unavailable.";
      $("#noFaq")?.classList.add("hidden");
    }
  }

  function renderFaq() {
    const list = $("#faqList");
    if (!list) return;
    const query = ($("#faqSearch")?.value || "").trim().toLowerCase();
    const matches = state.faq.filter(item =>
      `${item.question || ""} ${item.answer || ""} ${item.category || ""}`.toLowerCase().includes(query)
    );

    list.innerHTML = matches.map(item => `
      <article class="faq">
        <button type="button" class="question" aria-expanded="false">
          <span>${escapeHtml(item.question)}</span><b aria-hidden="true">+</b>
        </button>
        <div class="answer hidden">${escapeHtml(item.answer)}</div>
      </article>
    `).join("");

    const noResults = $("#noFaq");
    if (noResults) noResults.classList.toggle("hidden", matches.length > 0);
  }

  $("#faqSearch")?.addEventListener("input", renderFaq);

  $("#ticketForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("button[type='submit'], button:not([type])", form);
    const status = $("#ticketStatus");
    if (button) button.disabled = true;
    if (status) status.textContent = "Sending your request…";

    try {
      const payload = Object.fromEntries(new FormData(form));
      const result = await api("/api/tickets", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      form.classList.add("hidden");
      const success = $("#ticketSuccess");
      if (!success) throw new Error("Your request was created, but the confirmation panel could not be displayed.");

      success.classList.remove("hidden");
      success.innerHTML = `
        <h2>Request received</h2>
        <p>${escapeHtml(result.message || "Your support request was received.")}</p>
        <p><b>Ticket reference: ${escapeHtml(result.ticketCode)}</b></p>
        <p>Keep this private access token safe. Anyone with it can view the ticket.</p>
        <label>Private access token<input readonly value="${escapeHtml(result.accessToken)}"></label>
        <button type="button" id="viewTicket" class="primary">View conversation</button>
        <p>Confirmation email is not configured. Save your ticket reference and private access token.</p>
      `;
      $("#viewTicket")?.addEventListener("click", () => openCustomer(result.ticketCode, result.accessToken));
      showToast("Support request submitted.");
    } catch (error) {
      if (status) status.textContent = error.message;
    } finally {
      if (button) button.disabled = false;
    }
  });

  function initAdmin() {
    const login = $("#loginPanel");
    const panel = $("#adminPanel");
    if (!login || !panel) return;
    if (state.adminToken) {
      login.classList.add("hidden");
      panel.classList.remove("hidden");
      loadTickets();
    } else {
      login.classList.remove("hidden");
      panel.classList.add("hidden");
    }
  }

  $("#loginForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("button[type='submit'], button:not([type])", form);
    const status = $("#loginStatus");
    if (button) button.disabled = true;
    if (status) status.textContent = "Signing in…";

    try {
      const result = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form)))
      });
      state.adminToken = result.token;
      sessionStorage.setItem("savro_support_admin_token", result.token);
      if ($("#welcome")) $("#welcome").textContent = `Signed in as ${result.admin?.name || "Support Admin"}`;
      form.reset();
      if (status) status.textContent = "";
      initAdmin();
    } catch (error) {
      if (status) status.textContent = error.message;
    } finally {
      if (button) button.disabled = false;
    }
  });

  $("#logout")?.addEventListener("click", () => {
    state.adminToken = "";
    state.selectedTicket = null;
    sessionStorage.removeItem("savro_support_admin_token");
    initAdmin();
  });

  async function loadTickets() {
    if (!state.adminToken) return;
    const list = $("#ticketList");
    try {
      const params = new URLSearchParams();
      const status = $("#statusFilter")?.value || "";
      const query = $("#ticketSearch")?.value || "";
      if (status) params.set("status", status);
      if (query) params.set("q", query);

      const result = await api(`/api/admin/tickets?${params}`);
      state.tickets = Array.isArray(result.items) ? result.items : [];

      for (const key of ["open", "pending", "resolved"]) {
        const count = state.tickets.filter(ticket => ticket.status === key).length;
        const element = $(`#${key}Count`);
        if (element) element.textContent = String(count);
      }

      if (list) {
        list.innerHTML = state.tickets.length ? state.tickets.map(ticket => `
          <button type="button" class="ticketrow ${state.selectedTicket == ticket.id ? "selected" : ""}" data-ticket-id="${escapeHtml(ticket.id)}">
            <strong>${escapeHtml(ticket.subject)}</strong>
            <p>${escapeHtml(ticket.customer_name)} · ${escapeHtml(ticket.ticket_code)}</p>
            <p>${escapeHtml(String(ticket.last_message || "").slice(0, 90))}</p>
            <small>${formatDate(ticket.updated_at)}</small>
            <p><span class="pill ${escapeHtml(ticket.status)}">${escapeHtml(ticket.status)}</span></p>
          </button>
        `).join("") : "<p class='muted'>No tickets found.</p>";
      }
    } catch (error) {
      if (error.message.includes("sign in") || error.message.includes("Unauthorized")) {
        state.adminToken = "";
        sessionStorage.removeItem("savro_support_admin_token");
        initAdmin();
      }
      if (list) list.textContent = error.message;
    }
  }

  document.addEventListener("click", event => {
    const ticket = event.target.closest("[data-ticket-id]");
    if (ticket) openAdminTicket(ticket.dataset.ticketId);
  });

  async function openAdminTicket(id) {
    state.selectedTicket = Number(id);
    try {
      const result = await api(`/api/admin/tickets/${encodeURIComponent(id)}`);
      const ticket = result.ticket;
      const messages = Array.isArray(result.messages) ? result.messages : [];
      const detail = $("#detail");
      if (!detail) return;

      detail.innerHTML = `
        <span class="pill ${escapeHtml(ticket.status)}">${escapeHtml(ticket.status)}</span>
        <h2>${escapeHtml(ticket.subject)}</h2>
        <p class="muted">${escapeHtml(ticket.customer_name)} · ${escapeHtml(ticket.customer_email)} · ${escapeHtml(ticket.ticket_code)} · ${formatDate(ticket.created_at)}</p>
        <div class="controls">
          <label>Status <select id="detailStatus">
            <option value="open" ${ticket.status === "open" ? "selected" : ""}>Open</option>
            <option value="pending" ${ticket.status === "pending" ? "selected" : ""}>Pending</option>
            <option value="resolved" ${ticket.status === "resolved" ? "selected" : ""}>Resolved</option>
          </select></label>
          <label>Priority <select id="detailPriority">
            <option value="normal" ${ticket.priority === "normal" ? "selected" : ""}>Normal</option>
            <option value="high" ${ticket.priority === "high" ? "selected" : ""}>High</option>
          </select></label>
          <button type="button" id="saveTicket" class="outline">Save</button>
        </div>
        <div class="messages">${messages.map(message => `
          <article class="message ${message.sender_type === "admin" ? "admin" : ""}">
            <div class="messagehead"><span>${escapeHtml(message.sender_name)} · ${message.sender_type === "admin" ? "Support" : "Customer"}</span><time>${formatDate(message.created_at)}</time></div>
            <div class="messagebody">${escapeHtml(message.body)}</div>
          </article>
        `).join("")}</div>
        <form id="adminReplyForm" class="reply">
          <label>Reply to customer<textarea name="message" required minlength="2" maxlength="5000"></textarea></label>
          <button type="submit" class="primary">Save reply</button>
          <p class="muted">Email notifications are not configured yet.</p>
        </form>
      `;

      $("#saveTicket")?.addEventListener("click", async () => {
        try {
          await api(`/api/admin/tickets/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: $("#detailStatus").value,
              priority: $("#detailPriority").value
            })
          });
          await loadTickets();
          await openAdminTicket(id);
          showToast("Ticket updated.");
        } catch (error) { showToast(error.message); }
      });

      $("#adminReplyForm")?.addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = $("button[type='submit']", form);
        if (button) button.disabled = true;
        try {
          await api(`/api/admin/tickets/${encodeURIComponent(id)}/messages`, {
            method: "POST",
            body: JSON.stringify({ message: new FormData(form).get("message") })
          });
          await loadTickets();
          await openAdminTicket(id);
          showToast("Reply saved.");
        } catch (error) {
          showToast(error.message);
        } finally {
          if (button) button.disabled = false;
        }
      });

      await loadTickets();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function openCustomer(code, token) {
    state.customerCode = code;
    state.customerToken = token;
    showView("track");
    await loadCustomerTicket();
  }

  async function loadCustomerTicket() {
    if (!state.customerCode || !state.customerToken) return;
    try {
      const result = await api(`/api/tickets/${encodeURIComponent(state.customerCode)}`, {
        headers: { "X-Ticket-Access": state.customerToken }
      });
      const ticket = result.ticket;
      if ($("#trackTitle")) $("#trackTitle").textContent = `${ticket.ticketCode} — ${ticket.subject}`;
      if ($("#trackMeta")) $("#trackMeta").textContent = `Status: ${ticket.status} · Updated ${formatDate(ticket.updatedAt)}`;
      if ($("#trackMessages")) {
        $("#trackMessages").innerHTML = (result.messages || []).map(message => `
          <article class="message ${message.sender_type === "admin" ? "admin" : ""}">
            <div class="messagehead">${escapeHtml(message.sender_name)} · ${message.sender_type === "admin" ? "Savro Support" : "You"} <time>${formatDate(message.created_at)}</time></div>
            <div class="messagebody">${escapeHtml(message.body)}</div>
          </article>
        `).join("");
      }
      $("#customerReply")?.classList.toggle("hidden", ticket.status === "resolved");
    } catch (error) {
      if ($("#trackMessages")) $("#trackMessages").textContent = error.message;
    }
  }

  $("#customerReply")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const textarea = $("textarea", form);
    const status = $("#replyStatus");
    const button = $("button[type='submit'], button:not([type])", form);
    if (button) button.disabled = true;
    try {
      await api(`/api/tickets/${encodeURIComponent(state.customerCode)}/messages`, {
        method: "POST",
        headers: { "X-Ticket-Access": state.customerToken },
        body: JSON.stringify({ message: textarea?.value || "" })
      });
      if (textarea) textarea.value = "";
      await loadCustomerTicket();
      if (status) status.textContent = "Reply sent.";
    } catch (error) {
      if (status) status.textContent = error.message;
    } finally {
      if (button) button.disabled = false;
    }
  });

  function handleRoute() {
    const hash = location.hash.replace(/^#/, "");
    showView(["admin", "ticket", "track"].includes(hash) ? hash : "home", false);
  }

  window.addEventListener("hashchange", handleRoute);
  window.addEventListener("popstate", handleRoute);

  // Initial load and route handling.
  handleRoute();
})();
