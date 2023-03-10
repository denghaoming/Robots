import React, { Component } from 'react'
import { withNavigation } from '../../hocs'
import WalletState, { MAX_INT, ZERO_ADDRESS } from '../../state/WalletState';
import loading from '../../components/loading/Loading';
import toast from '../../components/toast/toast';
import Web3 from 'web3'
import { VipSale_ABI } from '../../abi/VipSale_ABI';
import '../Token/Token.css'

import Header from '../Header';
import { showFromWei } from '../../utils';
import BN from 'bn.js'
import moment from 'moment';
import copy from 'copy-to-clipboard';

class Vip extends Component {
    state = {
        chainId: '',
        account: '',
        sales: [],
        // vipChainId: 56,
        // errChainTip: '请连接BSC链钱包购买VIP',
        //测试火币链
        vipChainId: 128,
        errChainTip: '请连接Heco链钱包购买VIP',
        index: -1,
    }

    constructor(props) {
        super(props);
        this.refreshInfo = this.refreshInfo.bind(this);
    }

    //页面加载完
    componentDidMount() {
        this.handleAccountsChanged();
        WalletState.onStateChanged(this.handleAccountsChanged);
        this.refreshInfo();
    }

    //页面销毁前
    componentWillUnmount() {
        WalletState.removeListener(this.handleAccountsChanged);
        if (this._refreshInfoIntervel) {
            clearInterval(this._refreshInfoIntervel);
        }
    }

    //监听链接钱包
    handleAccountsChanged = () => {
        const wallet = WalletState.wallet;
        let page = this;
        page.setState({
            chainId: wallet.chainId,
            account: wallet.account,
        });
        if (wallet.chainId && wallet.chainId != this.state.vipChainId) {
            toast.show(this.state.errChainTip);
        }
    }

    _refreshInfoIntervel;
    refreshInfo() {
        if (this._refreshInfoIntervel) {
            clearInterval(this._refreshInfoIntervel);
        }
        this._refreshInfoIntervel = setInterval(() => {
            this.getInfo();
        }, 3000);
    }

    async getInfo() {
        if (this.state.vipChainId != this.state.chainId) {
            return;
        }
        try {
            const web3 = new Web3(Web3.givenProvider);
            const saleContract = new web3.eth.Contract(VipSale_ABI, WalletState.configs.VipSale);
            //获取基本信息
            let baseInfo = await saleContract.methods.shopInfo().call();
            console.log('baseInfo',baseInfo);
            //价格精度
            let priceDecimals = parseInt(baseInfo[0]);
            //价格符号
            let priceSymbol = baseInfo[1];
            //当前区块时间
            let blockTime = parseInt(baseInfo[2]);
            //共收入多少
            let totalAmount = baseInfo[3];
            //邀请奖励共多少
            let totalInviteAmount = baseInfo[4];
            //永久会员数量
            let maxVipNum = parseInt(baseInfo[5]);

            //销售列表
            const allSales = await saleContract.methods.allSales().call();
            //价格
            let prices = allSales[0];
            //有效期
            let durations = allSales[1];

            let sales = [];
            let len = prices.length;
            for (let i = 0; i < len; ++i) {
                let price = prices[i];
                let duration = durations[i];
                let showDuration;
                if (new BN(duration, 10).eq(new BN(MAX_INT, 10))) {
                    showDuration = '永久';
                } else {
                    showDuration = (parseInt(duration) / 86400) + '天';
                }
                sales.push({
                    price: price,
                    showPrice: showFromWei(price, priceDecimals, 6),
                    duration: duration,
                    showDuration: showDuration,
                })
            }

            this.setState({
                priceDecimals: priceDecimals,
                priceSymbol: priceSymbol,
                blockTime: blockTime,
                sales: sales,
            });

            let account = WalletState.wallet.account;
            if (account) {
                //获取用户信息
                const userInfo = await saleContract.methods.getUserInfo(account).call();
                //购买Vip共消费多少
                let amount = userInfo[0];
                //Vip过期时间
                let endTime = userInfo[1];
                //余额
                let balance = userInfo[2];

                let showEndTime;
                if (new BN(endTime, 10).eq(new BN(MAX_INT, 10))) {
                    showEndTime = '永久有效';
                } else if (parseInt(endTime) == 0) {
                    showEndTime = '未购买会员';
                } else {
                    showEndTime = this.formatTime(parseInt(endTime));
                }

                this.setState({
                    amount: amount,
                    showAmount: showFromWei(amount, priceDecimals, 6),
                    endTime: endTime,
                    showEndTime: showEndTime,
                    balance: balance,
                    showBalance: showFromWei(balance, priceDecimals, 6),
                    totalAmount:showFromWei(totalAmount,priceDecimals,6),
                    totalInviteAmount:showFromWei(totalInviteAmount,priceDecimals,6),
                    maxVipNum:maxVipNum,
                });
            }
        } catch (e) {
            console.log("getInfo", e.message);
            toast.show(e.message);
        } finally {
        }
    }

    formatTime(timestamp) {
        return moment(new BN(timestamp, 10).mul(new BN(1000)).toNumber()).format("YYYY-MM-DD HH:mm:ss");
    }

    //选择Vip种类
    selVip(index, e) {
        this.setState({
            index: index,
        })
    }

    //Vip种类样式
    getVipItemClass(index) {
        if (index == this.state.index) {
            return 'Vip-Item Item-Sel';
        }
        return 'Vip-Item Item-Nor';
    }

    //购买Vip
    async buyVip() {
        let account = WalletState.wallet.account;
        if (!account) {
            this.connectWallet();
            return;
        }
        let index = this.state.index;
        if (-1 == index) {
            toast.show('请选择要购买的会员等级');
            return;
        }
        let sale = this.state.sales[index];
        //需要的价格
        let price = new BN(sale.price, 10);
        let balance = new BN(this.state.balance, 10);
        if (balance.lt(price)) {
            toast.show(this.state.priceSymbol + '余额不足');
            return;
        }
        loading.show();
        try {
            const web3 = new Web3(Web3.givenProvider);
            const saleContract = new web3.eth.Contract(VipSale_ABI, WalletState.configs.VipSale);
            let invitor = this.getRef();
            if (!invitor) {
                invitor = ZERO_ADDRESS;
            }
            var estimateGas = await saleContract.methods.buy(index, invitor).estimateGas({ from: account, value: price });
            var transaction = await saleContract.methods.buy(index, invitor).send({ from: account, value: price });
            if (transaction.status) {
                toast.show("购买Vip成功");
            } else {
                toast.show("购买失败");
            }
        } catch (e) {
            console.log("e", e);
            toast.show(e.message);
        } finally {
            loading.hide();
        }
    }

    //获取邀请人
    getRef() {
        //先从链接获取，如果有，直接使用
        var url = window.location.href;
        var obj = new Object();
        var scan_url = url.split("?");
        if (2 == scan_url.length) {
            scan_url = scan_url[1];
            var strs = scan_url.split("&");
            for (var x in strs) {
                var arr = strs[x].split("=");
                obj[arr[0]] = arr[1];
                //链接里有邀请人
                if ("ref" == arr[0] && arr[1]) {
                    return arr[1];
                }
            }
        }
        //从浏览器缓存获取，这里可能部分浏览器不支持
        var storage = window.localStorage;
        if (storage) {
            return storage["ref"];
        }
        return null;
    }

    invite() {
        if (WalletState.wallet.account) {
            var url = window.location.href;
            url = url.split("?")[0];
            let inviteLink = url + "?ref=" + WalletState.wallet.account;
            if (copy(inviteLink)) {
                toast.show("邀请链接已复制")
            } else {
                toast.show("邀请失败")
            }
        }

    }

    render() {
        return (
            <div className="Token">
                <Header></Header>
                <div className='LabelContainer mb20'>
                    <div className='Label'>累计收入：{this.state.totalAmount} {this.state.priceSymbol}</div>
                    <div className='Label'>累计发放邀请奖励：{this.state.totalInviteAmount} {this.state.priceSymbol}</div>
                    <div className='Label'>永久会员数：{this.state.maxVipNum}</div>
                </div>
                <div className='flex ModuleTop'>
                    {
                        this.state.sales.map((item, index) => {
                            return <div key={index} className={this.getVipItemClass(index)} onClick={this.selVip.bind(this, index)}>
                                <div className=''>{item.showDuration}</div>
                                <div className='mt5'>{item.showPrice}{this.state.priceSymbol}</div>
                            </div>
                        })
                    }
                </div>

                <div className="button ModuleTop mb20" onClick={this.buyVip.bind(this)}>购买VIP</div>

                <div className='LabelContainer mb20'>
                    <div className='Label'>余额：{this.state.showBalance} {this.state.priceSymbol}</div>
                    <div className='Label'>VIP有效期：{this.state.showEndTime}</div>
                </div>

                <div className="button ModuleTop mb20 mt30" onClick={this.invite.bind(this)}>邀请好友</div>

            </div>
        );
    }
}

export default withNavigation(Vip);