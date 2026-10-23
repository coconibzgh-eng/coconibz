const backend = window.coconibzBackend;
const message = document.querySelector("#account-message");
const ordersMessage = document.querySelector("#orders-message");
const authPanel = document.querySelector("#auth-panel");
const accountPanel = document.querySelector("#account-panel");
const signupForm = document.querySelector("#signup-form");
const loginForm = document.querySelector("#login-form");
const otpForm = document.querySelector("#otp-form");
const resendOtpButton = document.querySelector("#resend-otp-button");
const ordersBody = document.querySelector("#orders-body");
const loadMoreButton = document.querySelector("#load-more-orders");
const pageSize = 100;
let orderOffset = 0;
let allOrders = [];
let hasMoreOrders = true;
let currentSession = null;
let requestedNext = new URLSearchParams(window.location.search).get("next");
let pendingPhone = "";

function normalizePhone(phone) {
  return phone.replace(/[()\s-]/g, "");
}

function formatGhs(amount) {
  return `GHS ${amount}`;
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("is-error", isError);
}

function getSafeNextUrl() {
  if (!requestedNext) return null;
  const target = new URL(requestedNext, window.location.href);
  return target.origin === window.location.origin ? target.href : null;
}

function continueAfterAuth() {
  const target = getSafeNextUrl();
  if (target) {
    window.location.replace(target);
    return true;
  }
  return false;
}

function setBusy(form, isBusy) {
  form.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy;
  });
}

async function getProfile(userId) {
  const { data, error } = await backend.client
    .from("profiles")
    .select("full_name, role")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

async function showSignedInAccount(session) {
  currentSession = session;
  if (!session) {
    authPanel.hidden = false;
    accountPanel.hidden = true;
    signupForm.hidden = false;
    loginForm.hidden = false;
    otpForm.hidden = true;
    return;
  }

  const profile = await getProfile(session.user.id);
  authPanel.hidden = true;
  accountPanel.hidden = false;
  document.querySelector("#account-welcome").textContent = `Hello, ${profile.full_name || "Coconibz customer"}`;
  document.querySelector("#admin-portal-link").hidden = !["admin", "retailer"].includes(profile.role);
  if (continueAfterAuth()) return;
  await loadOrders(true);
}

async function loadOrders(reset = false) {
  if (reset) {
    orderOffset = 0;
    allOrders = [];
    hasMoreOrders = true;
  }
  if (!hasMoreOrders) return;

  ordersMessage.textContent = "Loading your orders...";
  loadMoreButton.disabled = true;
  const { data, error } = await backend.client
    .from("orders")
    .select("id, shop_id, fulfillment, delivery_area, delivery_address, status, subtotal, delivery_fee, total, created_at, shops(name), order_items(product_key, flavor, quantity, unit_price, line_total)")
    .order("created_at", { ascending: false })
    .range(orderOffset, orderOffset + pageSize - 1);

  if (error) {
    ordersMessage.textContent = `Could not load your orders: ${error.message}`;
    ordersMessage.classList.add("is-error");
    loadMoreButton.disabled = false;
    return;
  }

  allOrders.push(...data);
  orderOffset += data.length;
  hasMoreOrders = data.length === pageSize;
  loadMoreButton.hidden = !hasMoreOrders;
  loadMoreButton.disabled = false;
  renderOrders();
}

function renderOrders() {
  const startDate = document.querySelector("#filter-start").value;
  const endDate = document.querySelector("#filter-end").value;
  const flavor = document.querySelector("#filter-flavor").value;
  const sort = document.querySelector("#order-sort").value;
  const filteredOrders = allOrders.filter((order) => {
    const orderDate = order.created_at.slice(0, 10);
    return (!startDate || orderDate >= startDate)
      && (!endDate || orderDate <= endDate)
      && (!flavor || order.order_items.some((item) => item.product_key === flavor));
  });

  filteredOrders.sort((first, second) => {
    if (sort === "flavor") {
      const firstFlavor = first.order_items.map((item) => item.flavor).sort()[0] || "";
      const secondFlavor = second.order_items.map((item) => item.flavor).sort()[0] || "";
      return firstFlavor.localeCompare(secondFlavor);
    }
    const comparison = new Date(first.created_at) - new Date(second.created_at);
    return sort === "oldest" ? comparison : -comparison;
  });

  ordersBody.replaceChildren();
  filteredOrders.forEach((order) => {
    const row = document.createElement("tr");
    const date = document.createElement("td");
    const shop = document.createElement("td");
    const flavors = document.createElement("td");
    const total = document.createElement("td");
    const status = document.createElement("td");

    date.textContent = new Date(order.created_at).toLocaleString();
    shop.textContent = order.fulfillment === "delivery"
      ? `Delivery · ${order.delivery_area}`
      : order.shops?.name || "Shop to be confirmed";
    flavors.textContent = order.order_items
      .map((item) => `${item.flavor} × ${item.quantity}`)
      .join(", ");
    total.textContent = formatGhs(order.total);
    const statusBadge = document.createElement("span");
    statusBadge.className = `order-status status-${order.status}`;
    statusBadge.textContent = order.status;
    status.append(statusBadge);
    row.append(date, shop, flavors, total, status);
    ordersBody.append(row);
  });

  ordersMessage.classList.remove("is-error");
  ordersMessage.textContent = filteredOrders.length
    ? `Showing ${filteredOrders.length} of ${allOrders.length} loaded orders${hasMoreOrders ? ". Load more to include older orders in the filters." : "."}`
    : allOrders.length
      ? "No orders match these filters."
      : "No saved order requests yet. Select your flavors and order to get started.";
}

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(signupForm, true);
  showMessage("Creating your account and sending a verification code...");
  const formData = new FormData(signupForm);
  pendingPhone = normalizePhone(String(formData.get("phone")));

  try {
    const { data, error } = await backend.client.auth.signUp({
      phone: pendingPhone,
      password: String(formData.get("password")),
      options: { data: { full_name: String(formData.get("full_name")).trim() } },
    });
    if (error) throw error;
    document.querySelector("#otp-phone-label").textContent = pendingPhone;
    signupForm.hidden = true;
    loginForm.hidden = true;
    otpForm.hidden = false;
    showMessage("Enter the SMS code to verify your phone.");
    if (data.session) {
      await showSignedInAccount(data.session);
    }
  } catch (error) {
    showMessage(`Could not create your account: ${error.message}`, true);
    setBusy(signupForm, false);
  }
});

otpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(otpForm, true);
  showMessage("Verifying your phone...");
  const token = String(new FormData(otpForm).get("token")).trim();

  try {
    const { data, error } = await backend.client.auth.verifyOtp({
      phone: pendingPhone,
      token,
      type: "sms",
    });
    if (error) throw error;
    showMessage("Phone verified successfully.");
    await showSignedInAccount(data.session);
  } catch (error) {
    showMessage(`Could not verify the code: ${error.message}`, true);
    setBusy(otpForm, false);
  }
});

resendOtpButton.addEventListener("click", async () => {
  setBusy(otpForm, true);
  showMessage("Requesting another verification code...");

  try {
    const { error } = await backend.client.auth.resend({
      type: "sms",
      phone: pendingPhone,
    });
    if (error) throw error;
    showMessage("A new verification code was requested. Check your SMS messages.");
  } catch (error) {
    showMessage(`Could not resend the verification code: ${error.message}`, true);
  } finally {
    setBusy(otpForm, false);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(loginForm, true);
  showMessage("Signing you in...");
  const formData = new FormData(loginForm);

  try {
    const { data, error } = await backend.client.auth.signInWithPassword({
      phone: normalizePhone(String(formData.get("phone"))),
      password: String(formData.get("password")),
    });
    if (error) throw error;
    await showSignedInAccount(data.session);
  } catch (error) {
    showMessage(`Could not sign in: ${error.message}`, true);
    setBusy(loginForm, false);
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  const { error } = await backend.client.auth.signOut();
  if (error) {
    showMessage(`Could not log out: ${error.message}`, true);
    return;
  }
  requestedNext = null;
  showMessage("You have been logged out.");
  await showSignedInAccount(null);
});

loadMoreButton.addEventListener("click", () => loadOrders());
["#filter-start", "#filter-end", "#filter-flavor", "#order-sort"].forEach((selector) => {
  document.querySelector(selector).addEventListener("change", renderOrders);
});

const menuToggle = document.querySelector(".menu-toggle");
const navMenu = document.querySelector("#primary-menu");
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
  document.querySelector(".site-header").classList.toggle("is-scrolled", window.scrollY > 12);
}, { passive: true });
document.querySelector("#current-year").textContent = String(new Date().getFullYear());

if (!backend?.configured) {
  showMessage("Accounts and order tracking are not active yet. Follow the Supabase setup instructions and add the project URL and public anon key to supabase-config.js.", true);
  signupForm.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
  loginForm.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
} else {
  backend.client.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    return showSignedInAccount(data.session);
  }).catch((error) => {
    showMessage(`Could not initialize your account: ${error.message}`, true);
  });
  backend.client.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
  });
}
