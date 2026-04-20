import streamlit as st
import pandas as pd
import numpy as np
import yfinance as yf
import plotly.express as px
import plotly.graph_objects as go

# ----------------------------
# Page config + UI tweaks
# ----------------------------
st.set_page_config(page_title="Portfolio Analytics Dashboard", page_icon="📊", layout="wide")

st.markdown(
    """
    <style>
    .block-container {padding-top: 1.2rem; padding-bottom: 2rem;}
    div[data-testid="stMetric"] {background: rgba(255,255,255,0.04); padding: 12px; border-radius: 12px;}
    .stButton>button {border-radius: 10px; padding: 0.6rem 1rem;}
    </style>
    """,
    unsafe_allow_html=True
)

# ----------------------------
# Helpers
# ----------------------------
def parse_tickers(text: str) -> list[str]:
    items = [t.strip().upper() for t in text.replace("\n", ",").split(",")]
    tickers = [t for t in items if t]
    seen, out = set(), []
    for t in tickers:
        if t not in seen:
            out.append(t)
            seen.add(t)
    return out

@st.cache_data(show_spinner=False)
def fetch_prices(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    data = yf.download(tickers, start=start, end=end, auto_adjust=True, progress=False)
    if isinstance(data.columns, pd.MultiIndex):
        prices = data["Close"].copy()
    else:
        prices = data.to_frame(name=tickers[0])
    prices = prices.dropna(how="all")
    return prices

def annualized_return(daily_returns: pd.Series) -> float:
    return (1 + daily_returns.mean()) ** 252 - 1

def annualized_vol(daily_returns: pd.Series) -> float:
    return daily_returns.std() * np.sqrt(252)

def sharpe_ratio(daily_returns: pd.Series, rf_annual: float = 0.0) -> float:
    rf_daily = (1 + rf_annual) ** (1/252) - 1
    excess = daily_returns - rf_daily
    if excess.std() == 0:
        return np.nan
    return (excess.mean() / excess.std()) * np.sqrt(252)

def max_drawdown(nav: pd.Series) -> float:
    peak = nav.cummax()
    dd = (nav / peak) - 1
    return dd.min()

# ----------------------------
# Sidebar inputs
# ----------------------------
st.sidebar.title("⚙️ Portfolio Inputs")

with st.sidebar.expander("1) Tickers", expanded=True):
    st.caption("For India NSE: use .NS (RELIANCE.NS). For BSE: .BO (500325.BO).")
    tickers_text = st.text_area(
        "Enter tickers (comma or new line separated)",
        value="AAPL, MSFT, NVDA, SPY",
        height=100
    )
    tickers = parse_tickers(tickers_text)

with st.sidebar.expander("2) Time period", expanded=True):
    c1, c2 = st.columns(2)
    with c1:
        start = st.date_input("Start date", value=pd.to_datetime("2022-01-01"))
    with c2:
        end = st.date_input("End date", value=pd.to_datetime("today"))

with st.sidebar.expander("3) Risk-free rate", expanded=True):
    rf = st.number_input("Risk-free rate (annual, decimal)", min_value=0.0, max_value=0.25, value=0.02, step=0.005)

# ----------------------------
# Main
# ----------------------------
st.title("📊 Portfolio Analytics Dashboard")
st.caption("Enter tickers → enter amounts invested → weights auto-calculated → analytics + heatmap.")

if len(tickers) < 1:
    st.warning("Please enter at least 1 ticker in the sidebar.")
    st.stop()

# ----------------------------
# Fetch prices
# ----------------------------
with st.spinner("Downloading price data..."):
    prices = fetch_prices(tickers, str(start), str(end))

if prices.empty or prices.shape[0] < 30:
    st.error("Not enough data returned. Check tickers or widen your date range.")
    st.stop()

# keep only tickers with data
valid_cols = [c for c in prices.columns if prices[c].dropna().shape[0] > 10]
prices = prices[valid_cols]
tickers = list(prices.columns)

if len(tickers) == 0:
    st.error("No valid tickers returned data. Please verify ticker symbols.")
    st.stop()

# ----------------------------
# Amount invested -> weights
# ----------------------------
st.subheader("💰 Amount Invested (used to calculate weights)")
st.caption("Enter the amount invested in each asset (any currency). Weights = amount / total.")

amount_cols = st.columns(min(4, len(tickers)))
amounts = []
for i, t in enumerate(tickers):
    with amount_cols[i % len(amount_cols)]:
        amt = st.number_input(f"{t} amount", min_value=0.0, value=1000.0, step=100.0)
        amounts.append(amt)

amounts = np.array(amounts, dtype=float)

if amounts.sum() == 0:
    st.error("Total invested amount is 0. Please enter at least one positive amount.")
    st.stop()

weights = amounts / amounts.sum()

weights_df = pd.DataFrame({"Ticker": tickers, "Amount": amounts, "Weight": weights})
weights_df["Weight %"] = (weights_df["Weight"] * 100).round(2)

# show weights table
st.dataframe(
    weights_df[["Ticker", "Amount", "Weight %"]].sort_values("Weight %", ascending=False),
    use_container_width=True
)

st.divider()

# ----------------------------
# Returns + NAV
# ----------------------------
returns = prices.pct_change().dropna()
returns = returns.replace([np.inf, -np.inf], np.nan).dropna(how="all")

port_ret = (returns * weights).sum(axis=1)
port_nav = (1 + port_ret).cumprod()
navs = (1 + returns).cumprod()

# ----------------------------
# KPIs
# ----------------------------
port_cagr = annualized_return(port_ret)
port_vol = annualized_vol(port_ret)
port_sharpe = sharpe_ratio(port_ret, rf_annual=rf)
port_mdd = max_drawdown(port_nav)

m1, m2, m3, m4 = st.columns(4)
m1.metric("Annualized Return", f"{port_cagr*100:.2f}%")
m2.metric("Annualized Volatility", f"{port_vol*100:.2f}%")
m3.metric("Sharpe (RF adj.)", f"{port_sharpe:.2f}")
m4.metric("Max Drawdown", f"{port_mdd*100:.2f}%")

st.divider()

# ----------------------------
# Charts
# ----------------------------
left, right = st.columns([1.3, 1])

with left:
    st.subheader("📈 Portfolio Growth (NAV)")
    fig_nav = go.Figure()
    fig_nav.add_trace(go.Scatter(x=port_nav.index, y=port_nav.values, mode="lines", name="Portfolio"))
    fig_nav.update_layout(
        height=420,
        margin=dict(l=10, r=10, t=40, b=10),
        xaxis_title="Date",
        yaxis_title="Growth of 1 unit",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    st.plotly_chart(fig_nav, use_container_width=True)

with right:
    st.subheader("🥧 Weights (from invested amounts)")
    fig_w = px.pie(weights_df, names="Ticker", values="Weight", hole=0.45)
    fig_w.update_layout(height=420, margin=dict(l=10, r=10, t=40, b=10))
    st.plotly_chart(fig_w, use_container_width=True)

st.divider()

c1, c2 = st.columns([1.2, 1])

with c1:
    st.subheader("📌 Daily Returns Distribution")
    fig_hist = px.histogram(port_ret, nbins=60, title=None)
    fig_hist.update_layout(height=380, margin=dict(l=10, r=10, t=40, b=10), xaxis_title="Daily return", yaxis_title="Count")
    st.plotly_chart(fig_hist, use_container_width=True)

with c2:
    st.subheader("📉 Drawdown Curve")
    rolling_peak = port_nav.cummax()
    drawdown = (port_nav / rolling_peak) - 1
    fig_dd = go.Figure()
    fig_dd.add_trace(go.Scatter(x=drawdown.index, y=drawdown.values, mode="lines", name="Drawdown"))
    fig_dd.update_layout(height=380, margin=dict(l=10, r=10, t=40, b=10), yaxis_title="Drawdown", xaxis_title="Date")
    st.plotly_chart(fig_dd, use_container_width=True)

st.divider()

# ----------------------------
# Heatmap (Correlation)
# ----------------------------
st.subheader("🔥 Correlation Heatmap (Daily Returns)")
corr = returns.corr()
fig_corr = px.imshow(corr, text_auto=True, aspect="auto", title=None)
fig_corr.update_layout(height=520, margin=dict(l=10, r=10, t=40, b=10))
st.plotly_chart(fig_corr, use_container_width=True)

# ----------------------------
# Asset stats table
# ----------------------------
st.subheader("📋 Asset-level Stats")
rows = []
for t in tickers:
    r = returns[t].dropna()
    if len(r) < 10:
        continue
    nav = (1 + r).cumprod()
    rows.append({
        "Ticker": t,
        "Ann Return %": annualized_return(r) * 100,
        "Ann Vol %": annualized_vol(r) * 100,
        "Sharpe": sharpe_ratio(r, rf_annual=rf),
        "Max DD %": max_drawdown(nav) * 100
    })
stats_df = pd.DataFrame(rows).sort_values("Sharpe", ascending=False).reset_index(drop=True)
stats_df = stats_df.round({"Ann Return %": 2, "Ann Vol %": 2, "Sharpe": 2, "Max DD %": 2})
st.dataframe(stats_df, use_container_width=True)

# ----------------------------
# Export
# ----------------------------
st.subheader("⬇️ Export")
export_df = pd.DataFrame({"Portfolio_Return": port_ret})
for t in tickers:
    export_df[f"{t}_Return"] = returns[t]

csv = export_df.dropna().to_csv(index=True).encode("utf-8")
st.download_button("Download daily returns CSV", data=csv, file_name="portfolio_returns.csv", mime="text/csv")

st.caption("Data source: Yahoo Finance via yfinance (Adjusted Close). For academic use, cite Yahoo Finance/yfinance.")
