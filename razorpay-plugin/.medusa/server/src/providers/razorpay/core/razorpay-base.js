"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
const types_1 = require("../types");
const update_razorpay_customer_metadata_1 = require("../../../workflows/update-razorpay-customer-metadata");
const get_smallest_unit_1 = require("../utils/get-smallest-unit");
const razorpay_1 = __importDefault(require("razorpay"));
class RazorpayBase extends utils_1.AbstractPaymentProvider {
    init() {
        const provider = this.options_.providers?.find((p) => p.id == RazorpayBase.identifier);
        if (!provider && !this.options_.key_id) {
            throw new utils_1.MedusaError(utils_1.MedusaErrorTypes.INVALID_ARGUMENT, "razorpay not configured", utils_1.MedusaErrorCodes.CART_INCOMPATIBLE_STATE);
        }
        this.razorpay_ =
            this.razorpay_ ||
                new razorpay_1.default({
                    key_id: this.options_.key_id ?? provider?.options.key_id,
                    key_secret: this.options_.key_secret ?? provider?.options.key_secret,
                    headers: {
                        "Content-Type": "application/json",
                        "X-Razorpay-Account": this.options_.razorpay_account ??
                            provider?.options.razorpay_account ??
                            undefined,
                    },
                });
    }
    constructor(container, options) {
        super(container, options);
        this.options_ = options;
        this.logger = container.logger;
        this.container_ = container;
        this.options_ = options;
        this.init();
    }
    static validateOptions(options) {
        if (!(0, utils_1.isDefined)(options.key_id)) {
            throw new Error("Required option `key_id` is missing in Razorpay plugin");
        }
        else if (!(0, utils_1.isDefined)(options.key_secret)) {
            throw new Error("Required option `key_secret` is missing in Razorpay plugin");
        }
    }
    buildError(message, e) {
        return {
            error: message,
            code: "code" in e ? e.code : "",
            detail: e.detail ?? e.message ?? "",
        };
    }
    async getRazorpayPaymentStatus(paymentIntent, attempts) {
        if (!paymentIntent) {
            return utils_1.PaymentSessionStatus.ERROR;
        }
        else {
            const authorisedAttempts = attempts.items.filter((i) => i.status == utils_1.PaymentSessionStatus.AUTHORIZED);
            const totalAuthorised = authorisedAttempts.reduce((p, c) => {
                p += parseInt(`${c.amount}`);
                return p;
            }, 0);
            return totalAuthorised == paymentIntent.amount
                ? utils_1.PaymentSessionStatus.CAPTURED
                : utils_1.PaymentSessionStatus.REQUIRES_MORE;
        }
    }
    async pollAndRetrieveCustomer(customer) {
        let customerList = [];
        let razorpayCustomer;
        const count = 10;
        let skip = 0;
        do {
            customerList = (await this.razorpay_.customers.all({
                count,
                skip,
            }))?.items;
            razorpayCustomer =
                customerList?.find((c) => c.contact == customer?.phone || c.email == customer.email) ?? customerList?.[0];
            if (razorpayCustomer) {
                await this.updateRazorpayMetadataInCustomer(customer, "rp_customer_id", razorpayCustomer.id);
                break;
            }
            if (!customerList || !razorpayCustomer) {
                throw new Error("no customers and cant create customers in razorpay");
            }
            skip += count;
        } while (customerList?.length == 0);
        return razorpayCustomer;
    }
    async fetchOrPollForCustomer(customer) {
        let razorpayCustomer;
        try {
            const rp_customer_id = customer.metadata?.razorpay?.rp_customer_id;
            if (rp_customer_id) {
                razorpayCustomer = await this.razorpay_.customers.fetch(rp_customer_id);
            }
            else {
                razorpayCustomer = await this.pollAndRetrieveCustomer(customer);
                this.logger.debug(`updated customer ${razorpayCustomer.email} with RpId :${razorpayCustomer.id}`);
            }
            return razorpayCustomer;
        }
        catch (e) {
            this.logger.error("unable to poll customer in the razorpay payment processor", {
                error: e?.message || e,
                code: e?.code,
            });
            return;
        }
    }
    async updateRazorpayMetadataInCustomer(customer, parameterName, parameterValue) {
        const metadata = customer.metadata;
        let razorpay = metadata?.razorpay;
        if (razorpay) {
            razorpay[parameterName] = parameterValue;
        }
        else {
            razorpay = {};
            razorpay[parameterName] = parameterValue;
        }
        const x = await (0, update_razorpay_customer_metadata_1.updateRazorpayCustomerMetadataWorkflow)(this.container_).run({
            input: {
                medusa_customer_id: customer.id,
                razorpay,
            },
        });
        const result = x.result.customer;
        return result;
        return customer;
    }
    async createRazorpayCustomer(customer, intentRequest, extra) {
        let razorpayCustomer;
        const phone = customer.phone ??
            extra.billing_address?.phone ??
            customer?.addresses.find((v) => v.phone != undefined)?.phone;
        const gstin = customer?.metadata?.gstin ?? undefined;
        if (!phone) {
            throw new Error("phone number to create razorpay customer");
        }
        if (!customer.email) {
            throw new Error("email to create razorpay customer");
        }
        const firstName = customer.first_name ?? "";
        const lastName = customer.last_name ?? "";
        try {
            const customerParams = {
                email: customer.email,
                contact: phone,
                gstin: gstin,
                fail_existing: 0,
                name: `${firstName} ${lastName} `,
                notes: {
                    updated_at: new Date().toISOString(),
                },
            };
            razorpayCustomer = await this.razorpay_.customers.create(customerParams);
            intentRequest.notes.razorpay_id = razorpayCustomer?.id;
            if (customer && customer.id) {
                await this.updateRazorpayMetadataInCustomer(customer, "rp_customer_id", razorpayCustomer.id);
            }
            return razorpayCustomer;
        }
        catch (e) {
            this.logger.error("unable to create customer in the razorpay payment processor", {
                error: e?.message || e,
                code: e?.code,
            });
            return;
        }
    }
    async createAccountHolder({ context, }) {
        const { account_holder, customer, idempotency_key } = context;
        if (account_holder?.data?.id) {
            return { id: account_holder.data.id };
        }
        if (!customer) {
            throw new Error("No customer provided while creating account holder");
        }
        try {
            const razorpayCustomer = await this.createRazorpayCustomer(customer, { notes: {} }, {});
            if (!razorpayCustomer) {
                throw new Error("Failed to create Razorpay customer");
            }
            return {
                id: razorpayCustomer.id,
                data: razorpayCustomer,
            };
        }
        catch (e) {
            this.logger.error("unable to create account holder in the razorpay payment processor", {
                error: e?.message || e,
                code: e?.code,
            });
            throw e;
        }
    }
    async editExistingRpCustomer(customer, intentRequest, extra) {
        let razorpayCustomer;
        const razorpay_id = intentRequest.notes?.razorpay_id ||
            customer.metadata?.razorpay_id ||
            customer.metadata?.razorpay?.rp_customer_id;
        try {
            razorpayCustomer = await this.razorpay_.customers.fetch(razorpay_id);
        }
        catch (e) {
            this.logger.warn("unable to fetch customer in the razorpay payment processor", {
                error: e?.message || e,
                code: e?.code,
            });
        }
        // edit the customer once fetched
        if (razorpayCustomer) {
            const editEmail = customer.email;
            const editName = `${customer.first_name} ${customer.last_name}`.trim();
            const editPhone = customer?.phone ||
                customer?.addresses.find((v) => v.phone != undefined)?.phone;
            try {
                const updateRazorpayCustomer = await this.razorpay_.customers.edit(razorpayCustomer.id, {
                    email: editEmail ?? razorpayCustomer.email,
                    contact: editPhone ?? razorpayCustomer.contact,
                    name: editName != "" ? editName : razorpayCustomer.name,
                });
                razorpayCustomer = updateRazorpayCustomer;
            }
            catch (e) {
                this.logger.warn("unable to edit customer in the razorpay payment processor", {
                    error: e?.message || e,
                    code: e?.code,
                });
            }
        }
        if (!razorpayCustomer) {
            try {
                razorpayCustomer = await this.createRazorpayCustomer(customer, intentRequest, extra);
            }
            catch (e) {
                this.logger.error("something is very wrong please check customer in the dashboard.", {
                    error: e?.message || e,
                    code: e?.code,
                });
            }
        }
        return razorpayCustomer; // returning un modified razorpay customer
    }
    async createOrUpdateCustomer(intentRequest, customer, extra) {
        let razorpayCustomer;
        try {
            const razorpay_id = customer.metadata?.razorpay?.rp_customer_id ||
                intentRequest.notes.razorpay_id;
            try {
                if (razorpay_id) {
                    this.logger.info("the updating  existing customer  in razorpay");
                    razorpayCustomer = await this.editExistingRpCustomer(customer, intentRequest, extra);
                }
            }
            catch (e) {
                this.logger.info("the customer doesn't exist in razopay");
            }
            try {
                if (!razorpayCustomer) {
                    this.logger.info("the creating  customer  in razopay");
                    razorpayCustomer = await this.createRazorpayCustomer(customer, intentRequest, extra);
                }
            }
            catch (e) {
                // if customer already exists in razorpay but isn't associated with a customer in medsusa
            }
            if (!razorpayCustomer) {
                try {
                    this.logger.info("relinking  customer  in razorpay by polling");
                    razorpayCustomer = await this.fetchOrPollForCustomer(customer);
                }
                catch (e) {
                    this.logger.error("unable to poll customer in the razorpay payment processor", {
                        error: e?.message || e,
                        code: e?.code,
                    });
                }
            }
            return razorpayCustomer;
        }
        catch (e) {
            this.logger.error("unable to retrieve customer from cart", {
                error: e?.message || e,
                code: e?.code,
            });
        }
        return razorpayCustomer;
    }
    async initiatePayment(input) {
        const intentRequestData = this.getPaymentIntentOptions();
        const { currency_code, amount } = input;
        const { cart, notes, session_id } = input.data;
        if (!cart) {
            throw new utils_1.MedusaError(utils_1.MedusaError.Types.INVALID_DATA, "cart not ready", utils_1.MedusaError.Codes.CART_INCOMPATIBLE_STATE);
        }
        const provider = this.options_.providers?.find((p) => p.id == RazorpayBase.identifier);
        if (!provider && !this.options_.key_id) {
            throw new utils_1.MedusaError(utils_1.MedusaErrorTypes.INVALID_ARGUMENT, "razorpay not configured", utils_1.MedusaErrorCodes.CART_INCOMPATIBLE_STATE);
        }
        const sessionNotes = notes ?? {};
        let toPay = (0, get_smallest_unit_1.getAmountFromSmallestUnit)(Math.round(Number(amount)), currency_code.toUpperCase());
        toPay = currency_code.toUpperCase() == "INR" ? toPay * 100 * 100 : toPay;
        const intentRequest = {
            amount: Math.round(toPay),
            currency: currency_code.toUpperCase(),
            notes: {
                ...sessionNotes,
                resource_id: session_id ?? "",
                session_id: session_id,
                cart_id: cart?.id,
            },
            payment: {
                capture: this.options_.auto_capture ?? provider?.options.auto_capture
                    ? "automatic"
                    : "manual",
                capture_options: {
                    refund_speed: this.options_.refund_speed ??
                        provider?.options.refund_speed ??
                        "normal",
                    automatic_expiry_period: Math.max(this.options_.automatic_expiry_period ??
                        provider?.options.automatic_expiry_period ??
                        20, 12),
                    manual_expiry_period: Math.max(this.options_.manual_expiry_period ??
                        provider?.options.manual_expiry_period ??
                        10, 7200),
                },
            },
            ...intentRequestData,
        };
        let session_data;
        const customerDetails = cart?.customer;
        try {
            const razorpayCustomer = await this.createOrUpdateCustomer(intentRequest, customerDetails, cart);
            try {
                if (razorpayCustomer) {
                    this.logger.debug(`the intent: ${JSON.stringify(intentRequest)}`);
                }
                else {
                    this.logger.error("unable to find razorpay customer");
                }
                const phoneNumber = razorpayCustomer?.contact ?? cart.billing_address?.phone;
                if (!phoneNumber) {
                    const e = new utils_1.MedusaError(utils_1.MedusaError.Types.INVALID_DATA, "no phone number", utils_1.MedusaError.Codes.CART_INCOMPATIBLE_STATE);
                }
                session_data = await this.razorpay_.orders.create({
                    ...intentRequest,
                });
            }
            catch (e) {
                new utils_1.MedusaError(utils_1.MedusaError.Types.INVALID_DATA, e, utils_1.MedusaError.Codes.UNKNOWN_MODULES);
            }
        }
        catch (e) {
            new utils_1.MedusaError(utils_1.MedusaError.Types.INVALID_DATA, e, utils_1.MedusaError.Codes.UNKNOWN_MODULES);
        }
        return {
            id: session_data?.id,
            data: { ...session_data, intentRequest: intentRequest },
        };
    }
    async authorizePayment(input) {
        const status = await this.getPaymentStatus(input);
        return {
            status: status.status,
            data: {
                ...status,
                intentRequest: input,
            },
        };
    }
    async capturePayment(paymentSessionData) {
        const order_id = paymentSessionData?.data?.data?.data?.id;
        const paymentsResponse = await this.razorpay_.orders.fetchPayments(order_id);
        const possibleCaptures = paymentsResponse.items?.filter((item) => item.status == "authorized");
        const result = possibleCaptures?.map(async (payment) => {
            const { id, amount, currency } = payment;
            const toPay = (0, get_smallest_unit_1.getAmountFromSmallestUnit)(Math.round(parseInt(amount.toString())), currency.toUpperCase()) * 100;
            const paymentIntent = await this.razorpay_.payments.capture(id, toPay, currency);
            return paymentIntent;
        });
        if (result) {
            const payments = await Promise.all(result);
            const res = payments.reduce((acc, curr) => ((acc[curr.id] = curr), acc), {});
            paymentSessionData.payments = res;
        }
        return {
            data: { ...paymentSessionData, intentRequest: paymentSessionData },
        };
    }
    async getPaymentStatus(paymentSessionData) {
        const id = paymentSessionData?.data?.id;
        let paymentIntent;
        let paymentsAttempted;
        try {
            paymentIntent = await this.razorpay_.orders.fetch(id);
            paymentsAttempted = await this.razorpay_.orders.fetchPayments(id);
        }
        catch (e) {
            this.logger.warn("received payment data from session not order data");
            paymentIntent = await this.razorpay_.orders.fetch(id);
            paymentsAttempted = await this.razorpay_.orders.fetchPayments(id);
        }
        switch (paymentIntent.status) {
            // created' | 'authorized' | 'captured' | 'refunded' | 'failed'
            case "created":
                return {
                    status: utils_1.PaymentSessionStatus.REQUIRES_MORE,
                    data: {
                        ...paymentSessionData,
                        intentRequest: paymentSessionData,
                    },
                };
            case "paid":
                return {
                    status: utils_1.PaymentSessionStatus.AUTHORIZED,
                    data: {
                        ...paymentSessionData,
                        intentRequest: paymentSessionData,
                    },
                };
            case "attempted":
                return {
                    status: await this.getRazorpayPaymentStatus(paymentIntent, paymentsAttempted),
                    data: {
                        ...paymentSessionData,
                        intentRequest: paymentSessionData,
                    },
                };
            default:
                return {
                    status: utils_1.PaymentSessionStatus.PENDING,
                    data: {
                        ...paymentSessionData,
                        intentRequest: paymentSessionData,
                    },
                };
        }
    }
    getPaymentIntentOptions() {
        const options = {};
        if (this?.paymentIntentOptions?.capture_method) {
            options.capture_method = this.paymentIntentOptions.capture_method;
        }
        if (this?.paymentIntentOptions?.setup_future_usage) {
            options.setup_future_usage = this.paymentIntentOptions.setup_future_usage;
        }
        if (this?.paymentIntentOptions?.payment_method_types) {
            options.payment_method_types =
                this.paymentIntentOptions.payment_method_types;
        }
        return options;
    }
    async deletePayment(input) {
        return await this.cancelPayment(input);
    }
    async cancelPayment(input) {
        const error = {
            error: "Unable to cancel as razorpay doesn't support cancellation",
            code: types_1.ErrorCodes.UNSUPPORTED_OPERATION,
        };
        return {
            data: {
                error,
            },
        };
    }
    async refundPayment(input) {
        const { data, amount } = input;
        const id = data.id;
        const paymentList = await this.razorpay_.orders.fetchPayments(id);
        const payment_id = paymentList.items?.find((p) => {
            return (parseInt(`${p.amount}`) >= Number(amount) * 100 &&
                (p.status == "authorized" || p.status == "captured"));
        })?.id;
        if (payment_id) {
            const refundRequest = {
                amount: Number(amount) * 100,
            };
            try {
                const refundSession = await this.razorpay_.payments.refund(payment_id, refundRequest);
                const refundsIssued = data?.refundSessions;
                if (refundsIssued?.length > 0) {
                    refundsIssued.push(refundSession);
                }
                else {
                    if (data) {
                        data.refundSessions = [refundSession];
                    }
                }
            }
            catch (e) {
                new utils_1.MedusaError(utils_1.MedusaError.Types.INVALID_DATA, e, utils_1.MedusaError.Codes.UNKNOWN_MODULES);
            }
        }
        return { data };
    }
    async retrievePayment(paymentSessionData) {
        let intent;
        try {
            const id = paymentSessionData
                .id;
            intent = await this.razorpay_.orders.fetch(id);
        }
        catch (e) {
            const id = paymentSessionData
                .order_id;
            try {
                intent = await this.razorpay_.orders.fetch(id);
            }
            catch (e) {
                new utils_1.MedusaError(utils_1.MedusaError.Types.INVALID_DATA, "An error occurred in retrievePayment", utils_1.MedusaError.Codes.UNKNOWN_MODULES);
            }
        }
        return {
            data: {
                ...intent,
            },
        };
    }
    async updatePayment(input) {
        const { amount, currency_code, context } = input;
        const { customer } = context ?? {};
        const { billing_address } = customer ?? {};
        if (!billing_address) {
            throw new utils_1.MedusaError(utils_1.MedusaErrorTypes.INVALID_DATA, "An error occurred in updatePayment during the retrieve of the cart", utils_1.MedusaErrorCodes.CART_INCOMPATIBLE_STATE);
        }
        let refreshedCustomer;
        let customerPhone = "";
        let razorpayId;
        if (customer) {
            try {
                refreshedCustomer = input.context?.customer;
                razorpayId = refreshedCustomer?.metadata?.razorpay
                    ?.rp_customer_id;
                customerPhone =
                    refreshedCustomer?.phone ?? billing_address?.phone ?? "";
                if (!refreshedCustomer.addresses.find((v) => v.id == billing_address?.id)) {
                    this.logger.warn("no customer billing found");
                }
            }
            catch {
                throw new utils_1.MedusaError(utils_1.MedusaErrorTypes.INVALID_DATA, "An error occurred in updatePayment during the retrieve of the customer", utils_1.MedusaErrorCodes.CART_INCOMPATIBLE_STATE);
            }
        }
        const isNonEmptyPhone = customerPhone || billing_address?.phone || customer?.phone || "";
        if (!razorpayId) {
            throw new utils_1.MedusaError(utils_1.MedusaErrorTypes.INVALID_DATA, "razorpay id not supported", utils_1.MedusaErrorCodes.CART_INCOMPATIBLE_STATE);
        }
        if (razorpayId !== customer?.id) {
            const phone = isNonEmptyPhone;
            if (!phone) {
                this.logger.warn("phone number wasn't specified");
                throw new utils_1.MedusaError(utils_1.MedusaErrorTypes.INVALID_DATA, "An error occurred in updatePayment during the retrieve of the customer", utils_1.MedusaErrorCodes.CART_INCOMPATIBLE_STATE);
            }
            const result = await this.initiatePayment(input);
            // TODO: update code block
            if (!result) {
                throw new utils_1.MedusaError(utils_1.MedusaErrorTypes.INVALID_DATA, "An error occurred in updatePayment during the initiate of the new payment for the new customer", utils_1.MedusaErrorCodes.CART_INCOMPATIBLE_STATE);
            }
            return result;
        }
        else {
            if (!amount) {
                throw new utils_1.MedusaError(utils_1.MedusaErrorTypes.INVALID_DATA, "amount  not valid", utils_1.MedusaErrorCodes.CART_INCOMPATIBLE_STATE);
            }
            if (!currency_code) {
                throw new utils_1.MedusaError(utils_1.MedusaErrorTypes.INVALID_DATA, "currency code not known", utils_1.MedusaErrorCodes.CART_INCOMPATIBLE_STATE);
            }
            try {
                const id = input.data.id;
                let sessionOrderData = {
                    currency: "INR",
                };
                if (id) {
                    sessionOrderData = (await this.razorpay_.orders.fetch(id));
                    delete sessionOrderData.id;
                    delete sessionOrderData.created_at;
                }
                input.currency_code =
                    currency_code?.toUpperCase() ?? sessionOrderData?.currency ?? "INR";
                const newPaymentSessionOrder = (await this.initiatePayment(input));
                return { data: { ...newPaymentSessionOrder.data } };
            }
            catch (e) {
                throw new utils_1.MedusaError(utils_1.MedusaErrorTypes.INVALID_DATA, "An error occurred in updatePayment", utils_1.MedusaErrorCodes.CART_INCOMPATIBLE_STATE);
            }
        }
    }
    async getWebhookActionAndData(webhookData) {
        const webhookSignature = webhookData.headers["x-razorpay-signature"];
        const webhookSecret = this.options_?.webhook_secret ||
            process.env.RAZORPAY_WEBHOOK_SECRET ||
            process.env.RAZORPAY_TEST_WEBHOOK_SECRET;
        const logger = this.logger;
        const data = webhookData.data;
        logger.info(`Received Razorpay webhook body as object : ${JSON.stringify(webhookData.data)}`);
        try {
            const validationResponse = razorpay_1.default.validateWebhookSignature(webhookData.rawData.toString(), webhookSignature, webhookSecret);
            // return if validation fails
            if (!validationResponse) {
                return { action: utils_1.PaymentActions.FAILED };
            }
        }
        catch (error) {
            logger.error(`Razorpay webhook validation failed : ${error}`);
            return { action: utils_1.PaymentActions.FAILED };
        }
        const paymentData = webhookData.data
            .payload?.payment?.entity;
        const event = data.event;
        const order = await this.razorpay_.orders.fetch(paymentData.order_id);
        /** sometimes this even fires before the order is updated in the remote system */
        const outstanding = (0, get_smallest_unit_1.getAmountFromSmallestUnit)(order.amount_paid == 0 ? paymentData.amount : order.amount_paid, paymentData.currency.toUpperCase());
        switch (event) {
            // payment authorization is handled in checkout flow. webhook not needed
            case "payment.captured":
                return {
                    action: utils_1.PaymentActions.SUCCESSFUL,
                    data: {
                        session_id: paymentData.notes.session_id,
                        amount: outstanding,
                    },
                };
            case "payment.authorized":
                return {
                    action: utils_1.PaymentActions.AUTHORIZED,
                    data: {
                        session_id: paymentData.notes.session_id,
                        amount: outstanding,
                    },
                };
            case "payment.failed":
                // TODO: notify customer of failed payment
                return {
                    action: utils_1.PaymentActions.FAILED,
                    data: {
                        session_id: paymentData.notes.session_id,
                        amount: outstanding,
                    },
                };
                break;
            default:
                return { action: utils_1.PaymentActions.NOT_SUPPORTED };
        }
    }
}
RazorpayBase.identifier = "razorpay";
exports.default = RazorpayBase;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmF6b3JwYXktYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uL3NyYy9wcm92aWRlcnMvcmF6b3JwYXkvY29yZS9yYXpvcnBheS1iYXNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEscURBUW1DO0FBNkJuQyxvQ0FRa0I7QUFDbEIsNEdBQThHO0FBQzlHLGtFQUF1RTtBQUN2RSx3REFBZ0M7QUFNaEMsTUFBZSxZQUFhLFNBQVEsK0JBQXVCO0lBTS9DLElBQUk7UUFDWixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQzVDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxJQUFJLFlBQVksQ0FBQyxVQUFVLENBQ3ZDLENBQUM7UUFFRixJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUN2QyxNQUFNLElBQUksbUJBQVcsQ0FDbkIsd0JBQWdCLENBQUMsZ0JBQWdCLEVBQ2pDLHlCQUF5QixFQUN6Qix3QkFBZ0IsQ0FBQyx1QkFBdUIsQ0FDekMsQ0FBQztRQUNKLENBQUM7UUFDRCxJQUFJLENBQUMsU0FBUztZQUNaLElBQUksQ0FBQyxTQUFTO2dCQUNkLElBQUksa0JBQVEsQ0FBQztvQkFDWCxNQUFNLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLElBQUksUUFBUSxFQUFFLE9BQU8sQ0FBQyxNQUFNO29CQUN4RCxVQUFVLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVLElBQUksUUFBUSxFQUFFLE9BQU8sQ0FBQyxVQUFVO29CQUNwRSxPQUFPLEVBQUU7d0JBQ1AsY0FBYyxFQUFFLGtCQUFrQjt3QkFDbEMsb0JBQW9CLEVBQ2xCLElBQUksQ0FBQyxRQUFRLENBQUMsZ0JBQWdCOzRCQUM5QixRQUFRLEVBQUUsT0FBTyxDQUFDLGdCQUFnQjs0QkFDbEMs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