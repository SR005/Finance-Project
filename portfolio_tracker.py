import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime, timedelta
import yfinance as yf
from scipy import stats
import warnings
warnings.filterwarnings('ignore')

# Page configuration
st.set_page_config(
    page_title="Portfolio Analytics Pro",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS for modern UI/UX
st.markdown("""
    <style>
    .main {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    div[data-testid="stMetricValue"] {
        font-size: 28px;
        font-weight: bold;
    }
    h1 {
        color: white;
        text-align: center;
        padding: 20px;
        text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
    }
    h2, h3 {
        color: #667eea;
    }
    </style>
""", unsafe_allow_html=True)

# Initialize session state
if 'portfolio' not in st.session_state:
    st.session_state.portfolio = pd.DataFrame(
        columns=['Ticker', 'Shares', 'Purchase_Price', 'Purchase_Date']
    )

# Global indices
GLOBAL_INDICES = {
    '^GSPC': 'S&P 500',
    '^IXIC': 'NASDAQ',
    '^FTSE': 'FTSE 100',
    '^GDAXI': 'DAX',
    '^N225': 'Nikkei 225',
}

# Popular stocks
POPULAR_STOCKS = {
    'Technology': ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'META', 'TSLA'],
    'Finance': ['JPM', 'BAC', 'V', 'MA', 'GS', 'MS'],
    'Healthcare': ['JNJ', 'UNH', 'PFE', 'ABBV', 'TMO', 'MRK'],
    'Consumer': ['AMZN', 'WMT', 'HD', 'NKE', 'MCD', 'COST'],
}

@st.cache_data(ttl=300)
def get_current_price(ticker):
    """Get current stock price"""
    try:
        stock = yf.Ticker(ticker)
        data = stock.history(period='1d')
        if not data.empty:
            return data['Close'].iloc[-1]
        return None
    except:
        return None

@st.cache_data(ttl=300)
def get_stock_info(ticker):
    """Get stock info including beta"""
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        return info.get('beta', 1.0)
    except:
        return 1.0

def calculate_portfolio_metrics(portfolio_df):
    """Calculate portfolio metrics"""
    if portfolio_df.empty:
        return None

    metrics = {}
    current_data = []

    for _, row in portfolio_df.iterrows():
        price = get_current_price(row['Ticker'])
        if price:
            current_data.append({
                'Ticker': row['Ticker'],
                'Shares': row['Shares'],
                'Purchase_Price': row['Purchase_Price'],
                'Current_Price': price,
                'Cost_Basis': row['Shares'] * row['Purchase_Price'],
                'Market_Value': row['Shares'] * price,
                'Gain_Loss': (row['Shares'] * price) - (row['Shares'] * row['Purchase_Price']),
                'Return_Pct': ((price - row['Purchase_Price']) / row['Purchase_Price']) * 100
            })

    if not current_data:
        return None

    df = pd.DataFrame(current_data)

    # Portfolio totals
    metrics['total_cost'] = df['Cost_Basis'].sum()
    metrics['total_value'] = df['Market_Value'].sum()
    metrics['total_gain_loss'] = df['Gain_Loss'].sum()
    metrics['total_return_pct'] = (metrics['total_gain_loss'] / metrics['total_cost']) * 100

    # Weights
    df['Weight'] = df['Market_Value'] / metrics['total_value']

    # Betas
    betas = []
    for ticker in df['Ticker']:
        beta = get_stock_info(ticker)
        betas.append(beta if beta else 1.0)

    df['Beta'] = betas
    metrics['portfolio_beta'] = (df['Weight'] * df['Beta']).sum()

    # Risk metrics
    returns = df['Return_Pct']
    metrics['volatility'] = returns.std() if len(returns) > 1 else 15.0

    risk_free_rate = 4.5
    metrics['sharpe_ratio'] = (metrics['total_return_pct'] - risk_free_rate) / metrics['volatility'] if metrics['volatility'] > 0 else 0
    metrics['var_95'] = metrics['total_value'] * 0.05 * metrics['portfolio_beta']
    metrics['max_drawdown'] = min(returns.min(), 0) if len(returns) > 0 else 0

    # Diversification
    metrics['num_holdings'] = len(df)
    metrics['concentration'] = df['Weight'].max()
    metrics['diversification_score'] = min(100, (metrics['num_holdings'] * 15) * (1 - metrics['concentration'] + 0.3))

    return metrics, df

@st.cache_data(ttl=600)
def get_index_performance():
    """Get index performance"""
    index_data = {}
    for ticker, name in GLOBAL_INDICES.items():
        try:
            stock = yf.Ticker(ticker)
            hist = stock.history(period='1y')
            if not hist.empty:
                ytd_return = ((hist['Close'].iloc[-1] - hist['Close'].iloc[0]) / hist['Close'].iloc[0]) * 100
                index_data[name] = ytd_return
        except:
            continue
    return index_data

# ==================== MAIN APP ====================

st.title("📊 Portfolio Analytics Pro")
st.markdown("### *Real-Time Portfolio Tracking with Risk Management*")

# Sidebar
with st.sidebar:
    st.header("➕ Add Stock")

    selected_sector = st.selectbox("Sector", list(POPULAR_STOCKS.keys()))
    selected_stock = st.selectbox("Stock", POPULAR_STOCKS[selected_sector])

    ticker = st.text_input("Ticker", value=selected_stock).upper()

    col1, col2 = st.columns(2)
    with col1:
        shares = st.number_input("Shares", min_value=0.01, value=10.0)
    with col2:
        purchase_price = st.number_input("Price ($)", min_value=0.01, value=100.0)

    purchase_date = st.date_input("Date", value=datetime.now() - timedelta(days=30))

    if st.button("🚀 Add to Portfolio", use_container_width=True):
        if ticker:
            current_price = get_current_price(ticker)
            if current_price:
                new_row = pd.DataFrame([{
                    'Ticker': ticker,
                    'Shares': shares,
                    'Purchase_Price': purchase_price,
                    'Purchase_Date': purchase_date
                }])
                st.session_state.portfolio = pd.concat([st.session_state.portfolio, new_row], ignore_index=True)
                st.success(f"✅ Added {ticker}!")
                st.rerun()
            else:
                st.error(f"❌ Invalid ticker: {ticker}")

    st.divider()

    if st.button("🗑️ Clear Portfolio", use_container_width=True):
        st.session_state.portfolio = pd.DataFrame(
            columns=['Ticker', 'Shares', 'Purchase_Price', 'Purchase_Date']
        )
        st.rerun()

# Main content
if st.session_state.portfolio.empty:
    st.info("👈 Add stocks from the sidebar to get started!")

    st.subheader("🌍 Global Market Overview")
    index_perf = get_index_performance()
    if index_perf:
        cols = st.columns(len(index_perf))
        for idx, (name, return_val) in enumerate(index_perf.items()):
            with cols[idx]:
                st.metric(name, f"{return_val:+.2f}%")
else:
    result = calculate_portfolio_metrics(st.session_state.portfolio)

    if result:
        metrics, portfolio_df = result

        # Top metrics
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            st.metric(
                "💰 Portfolio Value",
                f"${metrics['total_value']:,.2f}",
                f"${metrics['total_gain_loss']:+,.2f}"
            )

        with col2:
            st.metric(
                "📈 Total Return",
                f"{metrics['total_return_pct']:+.2f}%"
            )

        with col3:
            risk_level = "High" if metrics['portfolio_beta'] > 1.3 else "Medium" if metrics['portfolio_beta'] > 0.9 else "Low"
            st.metric(
                "⚠️ Beta",
                f"{metrics['portfolio_beta']:.2f}",
                risk_level
            )

        with col4:
            st.metric(
                "🎯 Sharpe",
                f"{metrics['sharpe_ratio']:.2f}"
            )

        # Tabs
        tab1, tab2, tab3, tab4 = st.tabs(["📋 Holdings", "📊 Analysis", "⚠️ Risk", "🌍 Benchmarks"])

        with tab1:
            st.subheader("Portfolio Holdings")

            display_df = portfolio_df[['Ticker', 'Shares', 'Purchase_Price', 'Current_Price', 
                                       'Market_Value', 'Gain_Loss', 'Return_Pct', 'Weight']].copy()

            display_df['Purchase_Price'] = display_df['Purchase_Price'].apply(lambda x: f"${x:.2f}")
            display_df['Current_Price'] = display_df['Current_Price'].apply(lambda x: f"${x:.2f}")
            display_df['Market_Value'] = display_df['Market_Value'].apply(lambda x: f"${x:,.2f}")
            display_df['Gain_Loss'] = display_df['Gain_Loss'].apply(lambda x: f"${x:+,.2f}")
            display_df['Return_Pct'] = display_df['Return_Pct'].apply(lambda x: f"{x:+.2f}%")
            display_df['Weight'] = display_df['Weight'].apply(lambda x: f"{x*100:.1f}%")

            st.dataframe(display_df, use_container_width=True, hide_index=True)

            col1, col2 = st.columns(2)

            with col1:
                fig_pie = px.pie(
                    portfolio_df,
                    values='Market_Value',
                    names='Ticker',
                    title='Portfolio Allocation'
                )
                st.plotly_chart(fig_pie, use_container_width=True)

            with col2:
                fig_bar = px.bar(
                    portfolio_df,
                    x='Ticker',
                    y='Return_Pct',
                    title='Stock Returns (%)',
                    color='Return_Pct',
                    color_continuous_scale=['red', 'yellow', 'green']
                )
                st.plotly_chart(fig_bar, use_container_width=True)

        with tab2:
            st.subheader("Performance Analysis")

            col1, col2 = st.columns(2)

            with col1:
                st.metric("Total Investment", f"${metrics['total_cost']:,.2f}")
                st.metric("Number of Holdings", f"{metrics['num_holdings']}")
                st.metric("Largest Position", f"{metrics['concentration']*100:.1f}%")

            with col2:
                st.metric("Current Value", f"${metrics['total_value']:,.2f}")
                st.metric("Unrealized Gain/Loss", f"${metrics['total_gain_loss']:+,.2f}")
                st.metric("Volatility", f"{metrics['volatility']:.2f}%")

        with tab3:
            st.subheader("Risk Management")

            col1, col2, col3 = st.columns(3)

            with col1:
                st.markdown("#### 📊 Risk Metrics")
                st.metric("Portfolio Beta", f"{metrics['portfolio_beta']:.2f}")
                st.metric("Volatility", f"{metrics['volatility']:.2f}%")
                st.metric("VaR (95%)", f"${metrics['var_95']:,.2f}")

            with col2:
                st.markdown("#### 🎯 Performance")
                st.metric("Sharpe Ratio", f"{metrics['sharpe_ratio']:.2f}")
                st.metric("Max Drawdown", f"{metrics['max_drawdown']:.2f}%")

            with col3:
                st.markdown("#### 🔄 Diversification")
                st.metric("Score", f"{metrics['diversification_score']:.0f}/100")
                st.progress(metrics['diversification_score']/100)

                if metrics['diversification_score'] < 50:
                    st.warning("⚠️ Low diversification")
                elif metrics['diversification_score'] < 70:
                    st.info("ℹ️ Moderate diversification")
                else:
                    st.success("✅ Good diversification")

            st.markdown("#### 💡 Recommendations")

            recommendations = []
            if metrics['portfolio_beta'] > 1.5:
                recommendations.append("🔴 High Beta (>1.5). Add defensive stocks.")
            if metrics['concentration'] > 0.4:
                recommendations.append("🟡 High concentration (>40%).")
            if metrics['num_holdings'] < 5:
                recommendations.append("🟡 Add more stocks (target 5-10).")

            if recommendations:
                for rec in recommendations:
                    st.markdown(f"- {rec}")
            else:
                st.success("✅ Healthy risk profile!")

        with tab4:
            st.subheader("Global Index Comparison")

            index_perf = get_index_performance()

            if index_perf:
                comparison_data = {
                    'Index': ['Your Portfolio'] + list(index_perf.keys()),
                    'Return (%)': [metrics['total_return_pct']] + list(index_perf.values())
                }

                comparison_df = pd.DataFrame(comparison_data)

                fig_comp = px.bar(
                    comparison_df,
                    x='Index',
                    y='Return (%)',
                    title='Performance vs Global Indices (YTD)',
                    color='Return (%)',
                    color_continuous_scale=['red', 'yellow', 'green']
                )
                st.plotly_chart(fig_comp, use_container_width=True)

                col1, col2 = st.columns(2)

                with col1:
                    beating = sum(1 for v in index_perf.values() if metrics['total_return_pct'] > v)
                    total = len(index_perf)
                    st.metric("Beating Indices", f"{beating}/{total}")

                with col2:
                    sp500 = index_perf.get('S&P 500', 0)
                    vs_sp = metrics['total_return_pct'] - sp500
                    st.metric("vs S&P 500", f"{vs_sp:+.2f}%")
    else:
        st.error("Unable to fetch prices. Check internet connection.")

st.divider()
st.markdown("""
    <div style='text-align: center; color: white;'>
        <p><strong>Portfolio Analytics Pro</strong> | Powered by Yahoo Finance</p>
        <p style='font-size: 12px;'>⚠️ Educational purposes only. Not financial advice.</p>
    </div>
""", unsafe_allow_html=True)
