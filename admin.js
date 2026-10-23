const backend = window.coconibzBackend;
const portalMessage = document.querySelector("#portal-message");
const dashboard = document.querySelector("#admin-dashboard");
const ordersMessage = document.querySelector("#orders-message");
const ordersBody = document.querySelector("#admin-orders-body");
const salesBody = document.querySelector("#sales-body");
const salesSection = document.querySelector("#sales-section");
const staffSection = document.querySelector("#staff-section");
const staffMessage = document.querySelector("#staff-message");
const loadMoreButton = document.querySelector("#admin-load-more");
const pageSize = 100;
const statuses = ["pending", "confirmed", "preparing", "ready", "completed", "cancelled"];
let role = "";
let authorizedShopIds = [];
let allShops = [];
let orders = [];
let orderOffset = 0;
let hasMoreOrders = true;
let loadingOrders = false;

function formatGhs(amount) {
  return `GHS ${amount}`;
}

function setPortalMessage(text, isError = false) {
  portalMessage.textContent = text;
  portalMessage.classList.toggle("is-error", isError);
}

function getFilterValue(id) {
  return document.querySelector(`#${id}`).value;
}

function startOfDay(date) {
  return `${date}T00:00:00.000Z`;
}

function startOfNextDay(date) {
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate.toISOString();
}

function selectedDateFilters() {
  return {
    start: getFilterValue("admin-start"),
    end: getFilterValue("admin-end"),
  };
}

async function loadSalesSummary() {
  if (role !== "admin") return;
  const { start, end } = selectedDateFilters();
  const { data, error } = await backend.client.rpc("coconibz_sales_summary", {
    p_start_date: start || null,
    p_end_date: end || null,
  });
  if (error) {
    setPortalMessage(`Could not load the financial summary: ${error.message}`, true);
    return;
  }

  const selectedShop = getFilterValue("admin-shop");
  const rows = selectedShop ? data.filter((row) => row.shop_id === selectedShop) : data;
  const completedOrders = rows.reduce((sum, row) => sum + Number(row.completed_orders), 0);
  const totalSales = rows.reduce((sum, row) => sum + Number(row.sales_total), 0);
  const summary = document.querySelector("#sales-summary");
  summary.replaceChildren();
  [
    ["Completed orders", completedOrders],
    ["Completed sales", formatGhs(totalSales)],
  ].forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "sales-summary-card";
    const caption = document.createElement("span");
    const amount = document.createElement("strong");
    caption.textContent = label;
    amount.textContent = String(value);
    card.append(caption, amount);
    summary.append(card);
  });

  salesBody.replaceChildren();
  rows.forEach((row) => {
    const tableRow = document.createElement("tr");
    const name = document.createElement("td");
    const count = document.createElement("td");
    const sales = document.createElement("td");
    name.textContent = row.shop_name;
    count.textContent = String(row.completed_orders);
    sales.textContent = formatGhs(Number(row.sales_total));
    tableRow.append(name, count, sales);
    salesBody.append(tableRow);
  });
  salesSection.hidden = false;
}

async function fetchOrders(reset = false) {
  if (loadingOrders || (!reset && !hasMoreOrders)) return;
  loadingOrders = true;
  if (reset) {
    orders = [];
    orderOffset = 0;
    hasMoreOrders = true;
  }
  ordersMessage.classList.remove("is-error");
  ordersMessage.textContent = "Loading orders...";
  loadMoreButton.disabled = true;

  const { start, end } = selectedDateFilters();
  const selectedShop = getFilterValue("admin-shop");
  let query = backend.client
    .from("orders")
    .select("id, shop_id, customer_name, customer_phone, fulfillment, delivery_area, delivery_address, status, subtotal, delivery_fee, total, created_at, shops(name), order_items(product_key, flavor, quantity, unit_price, line_total)")
    .order("created_at", { ascending: false })
    .range(orderOffset, orderOffset + pageSize - 1);

  if (start) query = query.gte("created_at", startOfDay(start));
  if (end) query = query.lt("created_at", startOfNextDay(end));
  if (selectedShop) query = query.eq("shop_id", selectedShop);
  else if (role === "retailer") query = query.in("shop_id", authorizedShopIds);
  const selectedStatus = getFilterValue("admin-status");
  if (selectedStatus) query = query.eq("status", selectedStatus);

  const { data, error } = await query;
  loadingOrders = false;
  loadMoreButton.disabled = false;
  if (error) {
    ordersMessage.textContent = `Could not load orders: ${error.message}`;
    ordersMessage.classList.add("is-error");
    return;
  }

  orders.push(...data);
  orderOffset += data.length;
  hasMoreOrders = data.length === pageSize;
  loadMoreButton.hidden = !hasMoreOrders;
  renderOrders();
}

function renderOrders() {
  const selectedFlavor = getFilterValue("admin-flavor");
  const sort = getFilterValue("admin-sort");
  const visibleOrders = orders.filter((order) =>
    !selectedFlavor || order.order_items.some((item) => item.product_key === selectedFlavor));

  visibleOrders.sort((first, second) => {
    if (sort === "flavor") {
      const firstFlavor = first.order_items.map((item) => item.flavor).sort()[0] || "";
      const secondFlavor = second.order_items.map((item) => item.flavor).sort()[0] || "";
      return firstFlavor.localeCompare(secondFlavor);
    }
    const comparison = new Date(first.created_at) - new Date(second.created_at);
    return sort === "oldest" ? comparison : -comparison;
  });

  ordersBody.replaceChildren();
  visibleOrders.forEach((order) => {
    const row = document.createElement("tr");
    const date = document.createElement("td");
    const customer = document.createElement("td");
    const shop = document.createElement("td");
    const flavors = document.createElement("td");
    const total = document.createElement("td");
    const statusCell = document.createElement("td");

    date.textContent = new Date(order.created_at).toLocaleString();
    customer.textContent = `${order.customer_name}\n${order.customer_phone}`;
    shop.textContent = order.fulfillment === "delivery"
      ? `Delivery · ${order.delivery_area}\n${order.delivery_address}`
      : order.shops?.name || "Shop to be confirmed";
    flavors.textContent = order.order_items.map((item) =>
      `${item.flavor} × ${item.quantity} (${formatGhs(item.line_total)})`).join(", ");
    total.textContent = formatGhs(order.total);
    const statusSelect = document.createElement("select");
    statusSelect.className = `order-status-select status-${order.status}`;
    statusSelect.setAttribute("aria-label", `Update order status for ${order.customer_name}`);
    statuses.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      statusSelect.append(option);
    });
    statusSelect.value = order.status;
    statusSelect.addEventListener("change", () => updateOrderStatus(order, statusSelect));
    statusCell.append(statusSelect);
    row.append(date, customer, shop, flavors, total, statusCell);
    ordersBody.append(row);
  });

  ordersMessage.classList.remove("is-error");
  ordersMessage.textContent = visibleOrders.length
    ? `Showing ${visibleOrders.length} of ${orders.length} loaded orders${hasMoreOrders ? ". Load more for older orders." : "."}`
    : orders.length
      ? "No orders match the selected flavor."
      : "No orders match the current filters.";
}

async function updateOrderStatus(order, select) {
  const previousStatus = order.status;
  select.disabled = true;
  const { error } = await backend.client
    .from("orders")
    .update({ status: select.value })
    .eq("id", order.id);
  select.disabled = false;

  if (error) {
    select.value = previousStatus;
    setPortalMessage(`Could not update the order status: ${error.message}`, true);
    return;
  }
  order.status = select.value;
  setPortalMessage("Order status updated.");
  if (role === "admin") await loadSalesSummary();
}

async function initializePortal() {
  if (!backend?.configured) {
    setPortalMessage("The portal is not connected. Complete the Supabase setup and add the project URL and public anon key to supabase-config.js.", true);
    return;
  }

  const { data, error } = await backend.client.auth.getSession();
  if (error) {
    setPortalMessage(`Could not check your sign-in: ${error.message}`, true);
    return;
  }
  if (!data.session) {
    setPortalMessage("Sign in with an authorized staff account to continue.", true);
    window.setTimeout(() => { window.location.href = "account.html"; }, 1200);
    return;
  }

  const { data: profile, error: profileError } = await backend.client
    .from("profiles")
    .select("full_name, role")
    .eq("id", data.session.user.id)
    .single();
  if (profileError) {
    setPortalMessage(`Could not verify your staff role: ${profileError.message}`, true);
    return;
  }
  if (!["admin", "retailer"].includes(profile.role)) {
    setPortalMessage("This account does not have staff access. Contact a COCONIBZ admin if you need access.", true);
    return;
  }

  role = profile.role;
  const { data: shopRows, error: shopsError } = await backend.client
    .from("shops")
    .select("id, name")
    .order("name");
  if (shopsError) {
    setPortalMessage(`Could not load shop details: ${shopsError.message}`, true);
    return;
  }
  allShops = shopRows;
  if (role === "retailer") {
    const { data: assignments, error: assignmentError } = await backend.client
      .from("retailer_shops")
      .select("shop_id")
      .eq("user_id", data.session.user.id);
    if (assignmentError) {
      setPortalMessage(`Could not load your shop access: ${assignmentError.message}`, true);
      return;
    }
    authorizedShopIds = assignments.map((assignment) => assignment.shop_id);
    if (!authorizedShopIds.length) {
      setPortalMessage("Your account is not assigned to a shop yet. Contact a COCONIBZ admin.", true);
      return;
    }
  }

  const shopSelect = document.querySelector("#admin-shop");
  const retailerShopSelect = document.querySelector("#retailer-shops");
  allShops.forEach((shop) => {
    const option = document.createElement("option");
    option.value = shop.id;
    option.textContent = shop.name;
    retailerShopSelect.append(option);
  });
  const visibleShops = role === "admin"
    ? allShops
    : allShops.filter((shop) => authorizedShopIds.includes(shop.id));
  visibleShops.forEach((shop) => {
    const option = document.createElement("option");
    option.value = shop.id;
    option.textContent = shop.name;
    shopSelect.append(option);
  });
  if (role === "retailer" && visibleShops.length === 1) {
    shopSelect.value = visibleShops[0].id;
    shopSelect.disabled = true;
  }

  document.querySelector("#portal-role-note").textContent = role === "admin"
    ? `Welcome, ${profile.full_name || "admin"}. You have all-shop access.`
    : `Welcome, ${profile.full_name || "retailer"}. Your orders are limited to your assigned shop${visibleShops.length === 1 ? "" : "es"}.`;
  dashboard.hidden = false;
  salesSection.hidden = role !== "admin";
  staffSection.hidden = role !== "admin";
  await Promise.all([
    fetchOrders(true),
    role === "admin" ? loadSalesSummary() : Promise.resolve(),
  ]);
}

document.querySelector("#staff-access-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const phone = document.querySelector("#retailer-phone").value.replace(/[()\s-]/g, "");
  const shopIds = [...document.querySelector("#retailer-shops").selectedOptions].map((option) => option.value);
  staffMessage.classList.remove("is-error");
  staffMessage.textContent = "Saving retailer access...";
  const { error } = await backend.client.rpc("admin_set_retailer_access", {
    p_phone: phone,
    p_shop_ids: shopIds,
  });
  if (error) {
    staffMessage.textContent = `Could not save retailer access: ${error.message}`;
    staffMessage.classList.add("is-error");
    return;
  }
  staffMessage.textContent = "Retailer access saved. The account can now sign in to the shop portal.";
});

document.querySelector("#remove-retailer-access").addEventListener("click", async () => {
  const phone = document.querySelector("#retailer-phone").value.replace(/[()\s-]/g, "");
  if (!phone) {
    staffMessage.textContent = "Enter the retailer's phone number first.";
    staffMessage.classList.add("is-error");
    return;
  }
  staffMessage.classList.remove("is-error");
  staffMessage.textContent = "Removing retailer access...";
  const { error } = await backend.client.rpc("admin_remove_retailer_access", { p_phone: phone });
  if (error) {
    staffMessage.textContent = `Could not remove retailer access: ${error.message}`;
    staffMessage.classList.add("is-error");
    return;
  }
  staffMessage.textContent = "Retailer access removed. The user can still sign in as a customer.";
});

document.querySelector("#portal-logout").addEventListener("click", async () => {
  if (!backend?.configured) return;
  const { error } = await backend.client.auth.signOut();
  if (error) {
    setPortalMessage(`Could not log out: ${error.message}`, true);
    return;
  }
  window.location.href = "account.html";
});

loadMoreButton.addEventListener("click", () => fetchOrders());
["admin-start", "admin-end", "admin-shop", "admin-status"].forEach((id) => {
  document.querySelector(`#${id}`).addEventListener("change", async () => {
    if (role === "admin" && ["admin-start", "admin-end", "admin-shop"].includes(id)) {
      await loadSalesSummary();
    }
    await fetchOrders(true);
  });
});
document.querySelector("#admin-flavor").addEventListener("change", renderOrders);
document.querySelector("#admin-sort").addEventListener("change", renderOrders);

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

initializePortal().catch((error) => {
  setPortalMessage(`Could not load the portal: ${error.message}`, true);
});
