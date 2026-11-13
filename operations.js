import "./supabase-client.js";

(() => {
  const backend = window.coconibzBackend;
  const message = document.querySelector("#ops-message");
  const dashboard = document.querySelector("#ops-dashboard");
  const tabs = document.querySelector("#ops-tabs");
  const content = document.querySelector("#ops-content");
  const state = {
    user: null,
    profile: null,
    shops: [],
    page: "overview",
    channel: null,
  };
  const pageNames = {
    overview: "Overview",
    inventory: "Stock",
    sales: "Retail sales",
    orders: "Orders & deliveries",
    payments: "Payments",
    customers: "Customers",
    feedback: "Customer feedback",
    audit: "Audit log",
  };

  function node(tag, className = "", text = "") {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== null && text !== undefined) result.textContent = String(text);
    return result;
  }

  function textCell(row, value) {
    const cell = node("td");
    cell.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
    row.append(cell);
    return cell;
  }

  function money(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function time(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString();
  }

  function label(value) {
    return String(value || "").replaceAll("_", " ");
  }

  function setMessage(text, isError = false) {
    message.classList.toggle("is-error", isError);
    message.replaceChildren();
    message.append(document.createTextNode(text));
  }

  function showError(error, target = message) {
    const errorText = error && error.message ? error.message : "The request failed. Please try again.";
    target.classList.add("is-error");
    target.textContent = errorText;
  }

  function field(title, control) {
    const wrapper = node("label", "ops-field", title);
    wrapper.append(control);
    return wrapper;
  }

  function input(type, placeholder = "") {
    const control = node("input");
    control.type = type;
    control.placeholder = placeholder;
    return control;
  }

  function select(options) {
    const control = node("select");
    options.forEach(([value, name]) => {
      const option = node("option", "", name);
      option.value = value;
      control.append(option);
    });
    return control;
  }

  function makeTable(headers, rows, emptyText) {
    const wrap = node("div", "ops-table-wrap");
    const table = node("table", "ops-table");
    const thead = node("thead");
    const heading = node("tr");
    headers.forEach((value) => heading.append(node("th", "", value)));
    thead.append(heading);
    const tbody = node("tbody");
    if (rows.length === 0) {
      const emptyRow = node("tr");
      const empty = node("td", "ops-empty", emptyText);
      empty.colSpan = headers.length;
      emptyRow.append(empty);
      tbody.append(emptyRow);
    } else {
      rows.forEach((row) => tbody.append(row));
    }
    table.append(thead, tbody);
    wrap.append(table);
    return wrap;
  }

  function row(values) {
    const tr = node("tr");
    values.forEach((value) => {
      if (value instanceof Node) tr.append(value);
      else textCell(tr, value);
    });
    return tr;
  }

  function section(title, subtitle = "") {
    const header = node("div", "ops-section-heading");
    header.append(node("h2", "", title));
    if (subtitle) header.append(node("p", "portal-subtitle", subtitle));
    return header;
  }

  function card(title, body, subtitle = "") {
    const panel = node("section", "ops-panel");
    panel.append(section(title, subtitle), body);
    return panel;
  }

  function metric(title, value, note = "") {
    const box = node("article", "ops-metric");
    box.append(node("span", "", title), node("strong", "", value));
    if (note) box.append(node("small", "", note));
    return box;
  }

  async function loadRows(tableName, columns, configure) {
    let query = backend.client.from(tableName).select(columns);
    if (configure) query = configure(query);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  function availableShopOptions() {
    return state.shops.map((shop) => [shop.id, shop.name]);
  }

  function shopName(shopId) {
    return state.shops.find((shop) => shop.id === shopId)?.name || "Unassigned delivery";
  }

  async function renderPage() {
    content.replaceChildren(node("p", "ops-loading", "Loading…"));
    try {
      if (state.page === "overview") await renderOverview();
      else if (state.page === "inventory") await renderInventory();
      else if (state.page === "sales") await renderSales();
      else if (state.page === "orders") await renderOrders();
      else if (state.page === "payments") await renderPayments();
      else if (state.page === "customers") await renderCustomers();
      else if (state.page === "feedback") await renderFeedback();
      else if (state.page === "audit") await renderAudit();
    } catch (error) {
      content.replaceChildren(node("p", "portal-message is-error", error.message || "Could not load this section."));
    }
  }

  async function renderOverview() {
    const [orders, inventory, sales, stockSummaryResult, stockMovements, products, shopPrices] = await Promise.all([
      loadRows("orders", "id,shop_id,customer_name,customer_phone,fulfillment,delivery_area,delivery_address,status,financial_status,total,created_at", (query) =>
        query.order("created_at", { ascending: false }).limit(100)),
      loadRows("shop_inventory", "shop_id,product_key,quantity_on_hand"),
      loadRows("retailer_sales", "shop_id,total_amount,sold_at", (query) =>
        query.order("sold_at", { ascending: false }).limit(100)),
      backend.client.rpc("coconibz_stock_supply_summary"),
      loadRows("stock_movements", "shop_id,product_key,movement_type,quantity_change,supply_unit_price,supply_total,note,created_at", (query) =>
        query.order("created_at", { ascending: false }).limit(50)),
      loadRows("coconibz_products", "product_key,name"),
      loadRows("shop_product_prices", "shop_id,product_key,unit_price"),
    ]);
    if (stockSummaryResult.error) throw stockSummaryResult.error;
    const openOrders = orders.filter((order) => !["completed", "cancelled"].includes(order.status)).length;
    const paymentFollowUp = orders.filter((order) => order.financial_status !== "paid").length;
    const lowStock = inventory.filter((item) => item.quantity_on_hand <= 5).length;
    const retailerTotal = sales.reduce((sum, item) => sum + Number(item.total_amount), 0);
    const stockTotals = new Map();
    inventory.forEach((item) => {
      stockTotals.set(item.shop_id, (stockTotals.get(item.shop_id) || 0) + Number(item.quantity_on_hand));
    });
    const productNames = new Map(products.map((product) => [product.product_key, product.name]));
    const wholesaleRates = new Map();
    shopPrices.forEach((price) => wholesaleRates.set(price.shop_id, Number(price.unit_price)));
    const stockSummary = (stockSummaryResult.data || []).slice().sort((left, right) =>
      shopName(left.shop_id).localeCompare(shopName(right.shop_id))
    );
    const metrics = node("div", "ops-metrics");
    metrics.append(
      metric("Open orders", openOrders, "Among the 100 most recent orders"),
      metric("Payment follow-up", paymentFollowUp, "Recent orders not marked paid"),
      metric("Low-stock lines", lowStock, "Five units or fewer"),
      metric("Recent retailer sales", money(retailerTotal), "Latest 100 sale records")
    );
    const intro = node("p", "portal-subtitle", "Operational summaries update from the shared Supabase database while this page is open. AI forecasts are not enabled.");
    const orderRows = orders.slice(0, 10).map((order) => row([
      time(order.created_at),
      order.customer_name,
      order.fulfillment === "delivery"
        ? `${order.delivery_area || "Area not set"} · ${order.delivery_address || "Address missing"}`
        : shopName(order.shop_id),
      money(order.total),
      label(order.status),
      label(order.financial_status),
    ]));
    const stockSupplyRows = stockSummary.map((shop) => row([
      shopName(shop.shop_id),
      money(wholesaleRates.get(shop.shop_id) ?? 12),
      Number(shop.units_supplied),
      stockTotals.get(shop.shop_id) || 0,
      time(shop.last_supplied_at),
      time(shop.last_activity_at),
    ]));
    const stockMovementRows = stockMovements.map((movement) => row([
      time(movement.created_at),
      shopName(movement.shop_id),
      productNames.get(movement.product_key) || movement.product_key,
      label(movement.movement_type),
      movement.quantity_change > 0 ? `+${movement.quantity_change}` : movement.quantity_change,
      movement.supply_unit_price === null ? "—" : money(movement.supply_unit_price),
      movement.supply_total === null ? "—" : money(movement.supply_total),
      movement.note,
    ]));
    content.replaceChildren(
      intro,
      metrics,
      card(
        "Stock supplied by retailer",
        makeTable(
          ["Retailer / shop", "Wholesale price / bottle", "Total supplied (units)", "Current stock (units)", "Last supplied", "Last stock activity"],
          stockSupplyRows,
          "No retailer stock activity has been recorded."
        ),
        "Totals include restocks and incoming transfers. Current stock and activity dates also update when a retailer records sales or fulfills pickup orders."
      ),
      card(
        "Recent stock activity",
        makeTable(
          ["Date", "Retailer / shop", "Product", "Activity", "Units", "Rate / bottle", "Supply value", "Note"],
          stockMovementRows,
          "No stock movements have been recorded."
        ),
        "Latest 50 stock movements, including supplies, sales, and order fulfillment. New supplies record their wholesale rate; older entries are not repriced."
      ),
      card("Latest orders and deliveries", makeTable(
        ["Placed", "Customer", "Shop / delivery", "Total", "Order status", "Payment"],
        orderRows,
        "No orders have been recorded."
      ))
    );
  }

  async function renderInventory() {
    const [inventory, products, prices] = await Promise.all([
      loadRows("shop_inventory", "shop_id,product_key,quantity_on_hand,updated_at"),
      loadRows("coconibz_products", "product_key,name,is_active", (query) => query.order("name")),
      loadRows("shop_product_prices", "shop_id,product_key,unit_price"),
    ]);
    const priceByShopProduct = new Map(
      prices.map((price) => [`${price.shop_id}:${price.product_key}`, Number(price.unit_price)])
    );
    const shopWholesalePrices = new Map();
    prices.forEach((price) => {
      if (!shopWholesalePrices.has(price.shop_id)) {
        shopWholesalePrices.set(price.shop_id, Number(price.unit_price));
      }
    });
    const sections = [];
    if (state.profile.role === "admin") {
      const activeProducts = products.filter((item) => item.is_active);
      const shop = select(availableShopOptions());
      const note = input("text", "Batch or delivery note (optional)");
      const quantityInputs = new Map();
      const priceLabels = new Map();
      const quantities = node("div", "ops-restock-grid");
      const estimate = node("p", "ops-restock-total");
      function wholesalePrice(productKey) {
        return priceByShopProduct.get(`${shop.value}:${productKey}`) ?? 12;
      }
      function updateRestockEstimate() {
        let totalUnits = 0;
        let totalValue = 0;
        activeProducts.forEach((product) => {
          const quantity = Number(quantityInputs.get(product.product_key).value);
          if (!Number.isInteger(quantity) || quantity <= 0) return;
          totalUnits += quantity;
          totalValue += quantity * wholesalePrice(product.product_key);
        });
        const bottleLabel = totalUnits === 1 ? "bottle" : "bottles";
        estimate.textContent = `Estimated wholesale value: ${money(totalValue)} · ${totalUnits} ${bottleLabel}`;
      }
      activeProducts.forEach((product) => {
        const quantity = input("number", "0");
        quantity.min = "0";
        quantity.step = "1";
        quantity.value = "0";
        quantity.setAttribute("aria-label", `Quantity to add for ${product.name}`);
        quantityInputs.set(product.product_key, quantity);
        const quantityField = field(
          `${product.name} · ${money(wholesalePrice(product.product_key))} / bottle`,
          quantity
        );
        priceLabels.set(product.product_key, quantityField.firstChild);
        quantity.addEventListener("input", updateRestockEstimate);
        quantities.append(quantityField);
      });
      shop.addEventListener("change", () => {
        activeProducts.forEach((product) => {
          priceLabels.get(product.product_key).textContent =
            `${product.name} · ${money(wholesalePrice(product.product_key))} / bottle`;
        });
        updateRestockEstimate();
      });
      updateRestockEstimate();
      const form = node("form", "ops-form ops-restock-form");
      const feedback = node("p", "ops-form-message");
      const save = node("button", "button button-primary", "Restock selected flavors");
      save.type = "submit";
      form.append(field("Retailer / shop", shop), field("Batch or delivery note (optional)", note), quantities, estimate, feedback, save);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        feedback.classList.remove("is-error");
        feedback.textContent = "";
        const movements = [];
        for (const product of activeProducts) {
          const value = quantityInputs.get(product.product_key).value.trim();
          if (!value) continue;
          const quantity = Number(value);
          if (!Number.isInteger(quantity) || quantity < 0) {
            showError(new Error(`Enter a whole number of zero or more for ${product.name}.`), feedback);
            return;
          }
          if (quantity > 0) {
            movements.push({
              shop_id: shop.value,
              product_key: product.product_key,
              movement_type: "restock",
              quantity_change: quantity,
              note: note.value.trim() || null,
              created_by: state.user.id,
            });
          }
        }
        if (movements.length === 0) {
          showError(new Error("Enter a quantity for at least one flavor."), feedback);
          return;
        }

        save.disabled = true;
        try {
          const { error } = await backend.client.from("stock_movements").insert(movements);
          if (error) {
            showError(error, feedback);
            return;
          }
          setMessage(`Restock recorded for ${movements.length} flavor${movements.length === 1 ? "" : "s"}.`);
          await renderPage();
        } catch (error) {
          showError(error, feedback);
        } finally {
          save.disabled = false;
        }
      });
      sections.push(card("Restock retailer stock", form, "Wholesale prices are applied automatically. Enter quantities for one shop and submit them together; zero quantities are skipped."));
    }
    const inventoryByShop = new Map();
    inventory.forEach((item) => {
      let shopStock = inventoryByShop.get(item.shop_id);
      if (!shopStock) {
        shopStock = { products: new Map(), updatedAt: null };
        inventoryByShop.set(item.shop_id, shopStock);
      }
      shopStock.products.set(item.product_key, item);
      if (!shopStock.updatedAt || new Date(item.updated_at) > new Date(shopStock.updatedAt)) {
        shopStock.updatedAt = item.updated_at;
      }
    });
    const stockRows = state.shops.map((shop) => {
      const shopStock = inventoryByShop.get(shop.id);
      const productCells = products.map((product) => {
        const cell = node("td");
        const item = shopStock?.products.get(product.product_key);
        if (!item) {
          cell.append(node("span", "ops-stock-missing", "—"));
          return cell;
        }
        const summary = node("div", "ops-stock-summary");
        summary.append(
          node("strong", "ops-stock-quantity", item.quantity_on_hand),
          item.quantity_on_hand <= 5
            ? node("span", "ops-pill ops-low", "Low stock")
            : node("span", "ops-pill", "In stock")
        );
        cell.append(summary);
        return cell;
      });
      const totalStock = products.reduce((sum, product) => {
        const item = shopStock?.products.get(product.product_key);
        return sum + Number(item ? item.quantity_on_hand : 0);
      }, 0);
      return row([
        shop.name,
        ...productCells,
        node("strong", "ops-stock-rate", `${money(shopWholesalePrices.get(shop.id) ?? 12)} / bottle`),
        node("strong", "ops-stock-total", totalStock),
        time(shopStock?.updatedAt),
      ]);
    });
    const stockTable = makeTable(
      ["Retailer / shop", ...products.map((product) => product.name), "Wholesale price / bottle", "Total units", "Last updated"],
      stockRows,
      "No retailer stock records are available yet."
    );
    stockTable.querySelector(".ops-table").classList.add("ops-stock-table");
    sections.push(card("Stock remaining by retailer", stockTable));
    content.replaceChildren(...sections);
  }

  async function renderSales() {
    const [sales, items, products] = await Promise.all([
      loadRows("retailer_sales", "id,shop_id,total_amount,payment_method,note,sold_at,recorded_by", (query) => query.order("sold_at", { ascending: false }).limit(100)),
      loadRows("retailer_sale_items", "sale_id,product_key,product_name,quantity,line_total"),
      loadRows("coconibz_products", "product_key,name,unit_price,is_active", (query) => query.eq("is_active", true).order("name")),
    ]);
    const itemGroups = new Map();
    items.forEach((item) => {
      const group = itemGroups.get(item.sale_id) || [];
      group.push(item);
      itemGroups.set(item.sale_id, group);
    });
    const form = node("form", "ops-form");
    const shop = select(availableShopOptions());
    const method = select([["", "Payment method not recorded"], ["cash", "Cash"], ["mobile_money", "Mobile Money"], ["other", "Other"]]);
    const note = input("text", "Optional sale note");
    const quantityInputs = new Map();
    const productFields = node("div", "ops-product-quantities");
    products.forEach((product) => {
      const quantity = input("number", "0");
      quantity.min = "0";
      quantity.step = "1";
      quantity.value = "0";
      quantity.className = "ops-quantity";
      quantityInputs.set(product.product_key, quantity);
      productFields.append(field(`${product.name} · ${money(product.unit_price)}`, quantity));
    });
    const feedback = node("p", "ops-form-message");
    const save = node("button", "button button-primary", "Record sale and update stock");
    save.type = "submit";
    form.append(field("Retailer / shop", shop), field("Payment method", method), field("Note", note), productFields, feedback, save);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const saleItems = [...quantityInputs.entries()]
        .map(([productKey, control]) => ({ product_key: productKey, quantity: Number(control.value) }))
        .filter((item) => item.quantity > 0);
      if (!saleItems.length) {
        showError({ message: "Enter a quantity for at least one product." }, feedback);
        return;
      }
      save.disabled = true;
      const { error } = await backend.client.rpc("coconibz_record_retailer_sale", {
        p_shop_id: shop.value,
        p_items: saleItems,
        p_payment_method: method.value || null,
        p_note: note.value.trim() || null,
      });
      save.disabled = false;
      if (error) {
        showError(error, feedback);
        return;
      }
      setMessage("Retailer sale saved and stock deducted.");
      await renderPage();
    });
    const shopMap = new Map(state.shops.map((item) => [item.id, item.name]));
    const saleRows = sales.map((sale) => row([
      time(sale.sold_at),
      shopMap.get(sale.shop_id) || sale.shop_id,
      (itemGroups.get(sale.id) || []).map((item) => `${item.product_name} × ${item.quantity}`).join(", "),
      money(sale.total_amount),
      label(sale.payment_method || "not recorded"),
      sale.note,
    ]));
    content.replaceChildren(
      card("Record a retailer sale", form, "Retail sales to customers remain GHS 12 per bottle. Saving a sale writes an audit entry and deducts the sold quantities from that shop's stock."),
      card("Recent retailer sales", makeTable(["Date", "Shop", "Items", "Total", "Payment", "Note"], saleRows, "No retailer sales have been recorded."))
    );
  }

  async function renderOrders() {
    const orders = await loadRows(
      "orders",
      "id,shop_id,customer_name,customer_phone,fulfillment,delivery_area,delivery_address,status,financial_status,payment_method,subtotal,delivery_fee,total,created_at",
      (query) => query.order("created_at", { ascending: false }).limit(500)
    );
    const orderRows = orders.map((order) => {
      const status = state.profile.role === "admin" || state.profile.role === "retailer"
        ? select(["pending", "confirmed", "preparing", "ready", "completed", "cancelled"].map((item) => [item, label(item)]))
        : node("span", "ops-pill", order.status);
      status.value = order.status;
      if (status instanceof HTMLSelectElement) {
        status.addEventListener("change", async () => {
          status.disabled = true;
          const { error } = await backend.client.from("orders").update({ status: status.value }).eq("id", order.id);
          status.disabled = false;
          if (error) {
            showError(error);
            status.value = order.status;
            return;
          }
          setMessage("Order status updated.");
          await renderPage();
        });
      }
      const customer = node("div");
      customer.append(node("strong", "", order.customer_name), node("small", "ops-subline", order.customer_phone));
      const fulfillment = order.fulfillment === "delivery"
        ? `${order.delivery_area || "Area not set"} · ${order.delivery_address || "Address missing"}`
        : shopName(order.shop_id);
      return row([
        time(order.created_at),
        customer,
        fulfillment,
        money(order.total),
        label(order.financial_status || "pending"),
        status,
      ]);
    });
    content.replaceChildren(
      node("p", "portal-subtitle", "Delivery locations are customer-entered addresses. Pickup stock is deducted when an order is marked completed; unassigned deliveries are not automatically deducted from a retailer."),
      card("Orders and delivery summary", makeTable(
        ["Placed", "Customer", "Shop / delivery location", "Total", "Payment", "Order status"],
        orderRows,
        "No orders have been recorded."
      ))
    );
  }

  async function renderPayments() {
    if (state.profile.role !== "admin") {
      content.replaceChildren(node("p", "portal-message is-error", "Payment records are restricted to admins."));
      return;
    }
    const [orders, payments] = await Promise.all([
      loadRows("orders", "id,shop_id,customer_name,customer_phone,total,financial_status,created_at", (query) => query.order("created_at", { ascending: false }).limit(100)),
      loadRows("payments", "id,order_id,method,status,amount,provider,provider_reference,created_at", (query) => query.order("created_at", { ascending: false }).limit(100)),
    ]);
    const orderSelect = select(orders.map((order) => [
      order.id,
      `#${order.id.slice(0, 8)} · ${order.customer_name} · ${money(order.total)} · ${label(order.financial_status)}`,
    ]));
    const method = select([["cash", "Cash"], ["mobile_money", "Mobile Money"], ["other", "Other"]]);
    const status = select([["pending", "Pending"], ["paid", "Paid"], ["failed", "Failed"], ["refunded", "Refunded"]]);
    const form = node("form", "ops-form");
    const feedback = node("p", "ops-form-message");
    const save = node("button", "button button-primary", "Record payment status");
    save.type = "submit";
    save.disabled = orders.length === 0;
    if (!orders.length) feedback.textContent = "There are no orders to record a payment for.";
    form.append(field("Order", orderSelect), field("Method", method), field("Status", status), feedback, save);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      const { error } = await backend.client.rpc("coconibz_record_order_payment", {
        p_order_id: orderSelect.value,
        p_method: method.value,
        p_status: status.value,
      });
      save.disabled = false;
      if (error) {
        showError(error, feedback);
        return;
      }
      setMessage("Payment status recorded.");
      await renderPage();
    });
    const orderMap = new Map(orders.map((order) => [order.id, order]));
    const rows = payments.map((payment) => {
      const order = orderMap.get(payment.order_id);
      return row([
        time(payment.created_at),
        order ? `#${order.id.slice(0, 8)} · ${order.customer_name}` : `#${payment.order_id.slice(0, 8)}`,
        money(payment.amount),
        label(payment.method),
        label(payment.status),
        payment.provider_reference,
      ]);
    });
    content.replaceChildren(
      card("Record a payment status", form, "Manual recording only. This does not verify a Mobile Money transaction or connect a payment provider."),
      card("Payment history", makeTable(["Recorded", "Order", "Amount", "Method", "Status", "Provider reference"], rows, "No payment records have been entered."))
    );
  }

  async function renderCustomers() {
    const orders = await loadRows("orders", "customer_name,customer_phone,total,created_at,status,financial_status,fulfillment,delivery_area,delivery_address", (query) =>
      query.order("created_at", { ascending: false }).limit(1000));
    const grouped = new Map();
    orders.forEach((order) => {
      const key = order.customer_phone;
      const customer = grouped.get(key) || {
        name: order.customer_name,
        phone: key,
        orders: 0,
        value: 0,
        latest: order.created_at,
        locations: new Set(),
      };
      customer.orders += 1;
      customer.value += Number(order.total);
      if (order.fulfillment === "delivery" && order.delivery_address) customer.locations.add(order.delivery_address);
      grouped.set(key, customer);
    });
    const rows = [...grouped.values()].map((customer) => row([
      customer.name,
      customer.phone,
      customer.orders,
      money(customer.value),
      [...customer.locations].join("; "),
      time(customer.latest),
    ]));
    content.replaceChildren(
      node("p", "portal-subtitle", "Grouped by phone from the 1,000 most recent orders visible to your account."),
      card("Customer order history", makeTable(
        ["Customer", "Phone", "Orders in loaded history", "Value in loaded history", "Delivery addresses", "Most recent order"],
        rows,
        "Customer history appears after orders are placed."
      ))
    );
  }

  async function renderFeedback() {
    const shop = select(availableShopOptions());
    const customer = input("text", "Optional customer name");
    const phone = input("tel", "Optional phone");
    const rating = select([["", "No rating"], ["1", "1 / 5"], ["2", "2 / 5"], ["3", "3 / 5"], ["4", "4 / 5"], ["5", "5 / 5"]]);
    const source = select([["website", "Website"], ["whatsapp", "WhatsApp"], ["phone", "Phone"], ["in_person", "In person"], ["other", "Other"]]);
    const comment = node("textarea");
    comment.required = true;
    comment.rows = 3;
    comment.placeholder = "Customer comment or review";
    const form = node("form", "ops-form");
    const feedback = node("p", "ops-form-message");
    const save = node("button", "button button-primary", "Save feedback");
    save.type = "submit";
    form.append(field("Retailer / shop", shop), field("Customer", customer), field("Phone", phone), field("Rating", rating), field("Received via", source), field("Comment", comment), feedback, save);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      const { error } = await backend.client.from("customer_feedback").insert({
        shop_id: shop.value || null,
        customer_name: customer.value.trim() || null,
        customer_phone: phone.value.trim() || null,
        rating: rating.value ? Number(rating.value) : null,
        source: source.value,
        comment: comment.value.trim(),
        recorded_by: state.user.id,
      });
      save.disabled = false;
      if (error) {
        showError(error, feedback);
        return;
      }
      setMessage("Customer feedback saved.");
      await renderPage();
    });
    const entries = await loadRows("customer_feedback", "id,shop_id,customer_name,customer_phone,rating,comment,source,created_at", (query) =>
      query.order("created_at", { ascending: false }).limit(100));
    const rows = entries.map((item) => row([
      time(item.created_at),
      shopName(item.shop_id),
      [item.customer_name, item.customer_phone].filter(Boolean).join(" · "),
      item.rating ? `${item.rating} / 5` : "—",
      item.comment,
      label(item.source),
    ]));
    content.replaceChildren(
      card("Record customer feedback", form, "Feedback is recorded by an authorized admin or retailer. A public customer review form is not enabled yet."),
      card("Recent comments", makeTable(["Received", "Shop", "Customer", "Rating", "Comment", "Source"], rows, "No comments have been recorded."))
    );
  }

  async function renderAudit() {
    if (state.profile.role !== "admin") {
      content.replaceChildren(node("p", "portal-message is-error", "Audit details are restricted to admins."));
      return;
    }
    const entries = await loadRows("coconibz_audit_logs", "id,table_name,record_id,action,old_data,new_data,actor_id,occurred_at", (query) =>
      query.order("occurred_at", { ascending: false }).limit(100));
    const rows = entries.map((entry) => {
      const details = node("details", "ops-audit-details");
      details.append(
        node("summary", "", "View change"),
        node("pre", "", JSON.stringify({ before: entry.old_data, after: entry.new_data }, null, 2))
      );
      return row([
        time(entry.occurred_at),
        entry.action,
        entry.table_name,
        entry.record_id,
        entry.actor_id || "System",
        details,
      ]);
    });
    content.replaceChildren(
      node("p", "portal-subtitle", "Append-only log of order, stock, sale, product, payment, feedback, and retailer-access changes. Before/after snapshots may include customer details."),
      card("Audit history", makeTable(["Time", "Action", "Area", "Record", "Actor", "Details"], rows, "No operations have been recorded."))
    );
  }

  function renderTabs() {
    const pages = state.profile.role === "admin"
      ? ["overview", "inventory", "sales", "orders", "payments", "customers", "feedback", "audit"]
      : ["overview", "inventory", "sales", "orders", "feedback"];
    tabs.replaceChildren();
    pages.forEach((page) => {
      const button = node("button", page === state.page ? "ops-tab is-active" : "ops-tab", pageNames[page]);
      button.type = "button";
      button.addEventListener("click", () => {
        state.page = page;
        renderTabs();
        renderPage();
      });
      tabs.append(button);
    });
  }

  async function initialize() {
    if (!backend?.configured) {
      setMessage("The portal is not connected. Complete the Supabase setup before using operations.", true);
      return;
    }
    const { data, error } = await backend.client.auth.getSession();
    if (error) {
      setMessage(`Could not check your sign-in: ${error.message}`, true);
      return;
    }
    if (!data.session) {
      setMessage("Sign in to your COCONIBZ account first, then open the operations portal.", true);
      return;
    }
    state.user = data.session.user;
    const { data: profile, error: profileError } = await backend.client
      .from("profiles")
      .select("id,full_name,role")
      .eq("id", state.user.id)
      .single();
    if (profileError) {
      setMessage(`Could not verify your account: ${profileError.message}`, true);
      return;
    }
    if (!["admin", "retailer"].includes(profile.role)) {
      setMessage("This account does not have operations access.", true);
      return;
    }
    state.profile = profile;
    const { data: shopRows, error: shopError } = await backend.client.from("shops").select("id,name").order("name");
    if (shopError) {
      setMessage(`Could not load shops: ${shopError.message}`, true);
      return;
    }
    if (profile.role === "admin") {
      state.shops = shopRows;
    } else {
      const { data: assignments, error: assignmentError } = await backend.client
        .from("retailer_shops")
        .select("shop_id")
        .eq("user_id", state.user.id);
      if (assignmentError) {
        setMessage(`Could not load your shop assignments: ${assignmentError.message}`, true);
        return;
      }
      const shopIds = new Set(assignments.map((item) => item.shop_id));
      state.shops = shopRows.filter((shop) => shopIds.has(shop.id));
      if (!state.shops.length) {
        setMessage("Your account is not assigned to a shop yet. Contact the COCONIBZ admin.", true);
        return;
      }
    }
    const shopText = profile.role === "admin"
      ? "Admin access · all shops"
      : `Retailer access · ${state.shops.map((shop) => shop.name).join(", ")}`;
    document.querySelector("#ops-role-note").textContent = `Welcome, ${profile.full_name || profile.role}. ${shopText}.`;
    dashboard.hidden = false;
    renderTabs();
    await renderPage();
    state.channel = backend.client
      .channel("coconibz-operations-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => renderPage())
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_inventory" }, () => renderPage())
      .on("postgres_changes", { event: "*", schema: "public", table: "retailer_sales" }, () => renderPage())
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => renderPage())
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_feedback" }, () => renderPage())
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setMessage("Live updates are disconnected. Refresh to reconnect.", true);
        }
      });
  }

  document.querySelector("#ops-logout").addEventListener("click", async () => {
    if (!backend?.configured) return;
    const { error } = await backend.client.auth.signOut();
    if (error) {
      showError(error);
      return;
    }
    if (state.channel) await backend.client.removeChannel(state.channel);
    window.location.href = "account.html";
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
  document.querySelector("#current-year").textContent = String(new Date().getFullYear());

  initialize().catch((error) => {
    setMessage(`Could not load operations: ${error.message}`, true);
  });
})();
