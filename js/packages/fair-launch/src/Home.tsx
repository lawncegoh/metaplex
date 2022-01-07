import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import {
  CircularProgress,
  Container,
  IconButton,
  Link,
  Slider,
  Snackbar,
} from '@material-ui/core';
import Paper from '@material-ui/core/Paper';
import Typography from '@material-ui/core/Typography';
import Grid from '@material-ui/core/Grid';
import { createStyles, Theme } from '@material-ui/core/styles';
import Dialog from '@material-ui/core/Dialog';
import MuiDialogTitle from '@material-ui/core/DialogTitle';
import MuiDialogContent from '@material-ui/core/DialogContent';
import CloseIcon from '@material-ui/icons/Close';
import Display from '../src/display.jpeg';

import Alert from '@material-ui/lab/Alert';

import * as anchor from '@project-serum/anchor';

import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletDialogButton } from '@solana/wallet-adapter-material-ui';

import {
  awaitTransactionSignatureConfirmation,
  CandyMachineAccount,
  CANDY_MACHINE_PROGRAM,
  getCandyMachineState,
  mintOneToken,
} from './candy-machine';

import {
  FairLaunchAccount,
  getFairLaunchState,
  punchTicket,
  purchaseTicket,
} from './fair-launch';

import { AlertState, formatNumber, getAtaForMint, toDate } from './utils';
import { CTAButton, MintButton } from './MintButton';
import { AntiRug } from './AntiRug';
import { getPhase, Phase, PhaseHeader } from './PhaseHeader';
import { GatewayProvider } from '@civic/solana-gateway-react';

const ConnectButton = styled(WalletDialogButton)`
  width: 100%;
  height: 60px;
  margin-top: 10px;
  margin-bottom: 5px;
  background: linear-gradient(180deg, #604ae5 0%, #813eee 100%);
  color: white;
  font-size: 16px;
  font-weight: bold;
`;

const MintContainer = styled.div``; // add your styles here

const dialogStyles: any = (theme: Theme) =>
  createStyles({
    root: {
      margin: 0,
      padding: theme.spacing(2),
    },
    closeButton: {
      position: 'absolute',
      right: theme.spacing(1),
      top: theme.spacing(1),
      color: theme.palette.grey[500],
    },
  });

const ValueSlider = styled(Slider)({
  color: '#C0D5FE',
  height: 8,
  '& > *': {
    height: 4,
  },
  '& .MuiSlider-track': {
    border: 'none',
    height: 4,
  },
  '& .MuiSlider-thumb': {
    height: 24,
    width: 24,
    marginTop: -10,
    background: 'linear-gradient(180deg, #604AE5 0%, #813EEE 100%)',
    border: '2px solid currentColor',
    '&:focus, &:hover, &.Mui-active, &.Mui-focusVisible': {
      boxShadow: 'inherit',
    },
    '&:before': {
      display: 'none',
    },
  },
  '& .MuiSlider-valueLabel': {
    '& > *': {
      background: 'linear-gradient(180deg, #604AE5 0%, #813EEE 100%)',
    },
    lineHeight: 1.2,
    fontSize: 12,
    padding: 0,
    width: 32,
    height: 32,
    marginLeft: 9,
  },
});

export interface HomeProps {
  candyMachineId?: anchor.web3.PublicKey;
  fairLaunchId?: anchor.web3.PublicKey;
  connection: anchor.web3.Connection;
  startDate: number;
  txTimeout: number;
  rpcHost: string;
}

const FAIR_LAUNCH_LOTTERY_SIZE =
  8 + // discriminator
  32 + // fair launch
  1 + // bump
  8; // size of bitmask ones

const isWinner = (fairLaunch: FairLaunchAccount | undefined): boolean => {
  if (
    !fairLaunch?.lottery.data ||
    !fairLaunch?.lottery.data.length ||
    !fairLaunch?.ticket.data?.seq ||
    !fairLaunch?.state.phaseThreeStarted
  ) {
    return false;
  }

  const myByte =
    fairLaunch.lottery.data[
      FAIR_LAUNCH_LOTTERY_SIZE +
        Math.floor(fairLaunch.ticket.data?.seq.toNumber() / 8)
    ];

  const positionFromRight = 7 - (fairLaunch.ticket.data?.seq.toNumber() % 8);
  const mask = Math.pow(2, positionFromRight);
  const isWinner = myByte & mask;
  return isWinner > 0;
};

const Home = (props: HomeProps) => {
  const [fairLaunchBalance, setFairLaunchBalance] = useState<number>(0);
  const [yourSOLBalance, setYourSOLBalance] = useState<number | null>(null);
  const rpcUrl = props.rpcHost;

  const [isMinting, setIsMinting] = useState(false); // true when user got to press MINT
  const [contributed, setContributed] = useState(0);
  const [isDisabled, setIsDisabled] = useState(true);

  const wallet = useWallet();

  const anchorWallet = useMemo(() => {
    if (
      !wallet ||
      !wallet.publicKey ||
      !wallet.signAllTransactions ||
      !wallet.signTransaction
    ) {
      return;
    }

    return {
      publicKey: wallet.publicKey,
      signAllTransactions: wallet.signAllTransactions,
      signTransaction: wallet.signTransaction,
    } as anchor.Wallet;
  }, [wallet]);

  const [alertState, setAlertState] = useState<AlertState>({
    open: false,
    message: '',
    severity: undefined,
  });

  const [fairLaunch, setFairLaunch] = useState<FairLaunchAccount>();
  const [candyMachine, setCandyMachine] = useState<CandyMachineAccount>();
  const [howToOpen, setHowToOpen] = useState(false);
  const [refundExplainerOpen, setRefundExplainerOpen] = useState(false);

  const onMint = async () => {
    try {
      setIsMinting(true);
      document.getElementById('#identity')?.click();
      if (wallet.connected && candyMachine?.program && wallet.publicKey) {
        if (fairLaunch?.ticket.data?.state.unpunched && isWinner(fairLaunch)) {
          await onPunchTicket();
        }

        const mintTxId = (
          await mintOneToken(candyMachine, wallet.publicKey)
        )[0];

        let status: any = { err: true };
        if (mintTxId) {
          status = await awaitTransactionSignatureConfirmation(
            mintTxId,
            props.txTimeout,
            props.connection,
            'singleGossip',
            true,
          );
        }

        if (!status?.err) {
          setAlertState({
            open: true,
            message: 'Congratulations! Mint succeeded!',
            severity: 'success',
          });
        } else {
          setAlertState({
            open: true,
            message: 'Mint failed! Please try again!',
            severity: 'error',
          });
        }
      }
    } catch (error: any) {
      // TODO: blech:
      let message = error.msg || 'Minting failed! Please try again!';
      if (!error.msg) {
        if (!error.message) {
          message = 'Transaction Timeout! Please try again.';
        } else if (error.message.indexOf('0x138')) {
        } else if (error.message.indexOf('0x137')) {
          message = `SOLD OUT!`;
        } else if (error.message.indexOf('0x135')) {
          message = `Insufficient funds to mint. Please fund your wallet.`;
        }
      } else {
        if (error.code === 311) {
          message = `SOLD OUT!`;
          window.location.reload();
        } else if (error.code === 312) {
          message = `Minting period hasn't started yet.`;
        }
      }

      setAlertState({
        open: true,
        message,
        severity: 'error',
      });
    } finally {
      setIsMinting(false);
    }
  };

  useEffect(() => {
    (async () => {
      if (!anchorWallet) {
        return;
      }

      const WL = [
        'D6br5rfg3DNfRX4hY2ZKEuwzDJeCaabKmhjeehSRCZj9',
        '37QcyyRJ4uxu6ChCuJDrkqNaeCHR1y8ZyZLFHRWHCDVZ',
        'Gy5iZitSMiDbqWzTWJc4ckQDNXnDVD4ZuSrRzsrWCxcz',
        'EMAUwCrWxD2oTGerdu1wmXe2gmEz5a6JwKhJfNDC264h',
        'HeWyrXHyxEbs3WAKvTBFqLT6s87XRzMAxHHKzu4drPW7',
        'XiSjH29qcPZ8b9B3fvMKfYpqBHargUtVoBTdcGrjDPW',
        'J158xUL9UdSXc7HQgZqVp9Erq1iYQEKY8voq1K1ZGz7W',
        'DAFEBYSqRdHk9HmuzTz6HcJhT2njhqaH45eRmq4DvsWP',
        'EeXEqcKhfU4abc3rQqmztPTd46wPFkeC1E8Rq5bgkbW5',
        '4anEncBKm7GLq1vsu5Eu4yjai4gtxLpErmtHbHGdw7zq',
        '2LVDC9SoT6redbFKWXqkCZHgsCB9twEmi9XQhnjkBswK',
        'ErnfF3Nppvkn7GewYWXdtEWRNVGi72LyADNkPXT7YnVp',
        '2kx9tXpqEF7vEfFxSUfqPLUQa3LpgVMTjZQcM4R9Zf8E',
        '55Ko3gnC2ZLjtrLT98vg6U9HfB8ELQqWRPNF3Usi5mkt',
        '3HGJzPygqf4p8DgQv4xCuKNoPRFiQxSjmrKZ8T1PtdGB',
        'BxCRGj4fGqJcZxdusT9kq8J7vozmFSGFdue9DQAvd4yp',
        '7xFb3TdAPmUkfV7tiSHePrD7No3bUWXGZLxmnX36ZSnC',
        '53BTXRNa74kiw37ughwAVhVCtAdscyJ9FVkt8Y6wxrpT',
        'GDs7ksRGe6p7TzHbMe8eRCDUgP69Jfb22bzUpaMdyrU2',
        '2VXs6BQX2X4rUNBESmPqNKDisUAB1c6LEoDa92QSgXft',
        '7BGQsGQrZhqtKBtyg8zfThnAaSrPA5cuLppfRGnj4sPV',
        '5RXQkRj73nWFwq62EjohSo88QT2KX7BmTxRKqHqfSCEA',
        '21smUJsMkn4YiE5sVNH1RKkNCY9x65pbDG28Sco7ZV4J',
        'AG1KA4aHVRVPJcLXR3xuLmncVL5s6PkqtXhWRkq9ybgB',
        'EATo6K3CVV7wPHu9FWh3SUSKr58JCcCnsTrHRPr6mxao',
        '8GunLeiRykRwxZxW6B1cY9JAwBZi7wtG5b8FdyRKXBwE',
        'Arv3X2By1nQBY4vgZRfPGTizSdtA743Etsj6zi4aMsir',
        'ChgftE2LKW9W3xVqCTqFuoW3LH2waZbptJ7KMsaj7rvf',
        '0x181d20CeD14B766274dc774F4350290c5347B968',
        'EsjrgK12iGwyboiPrkEHHHg81n1SyknHD949eLoGYpuJ',
        '6eymKiVJex1D6hBDmE3bqreJuJjs2Bvzp4AiA9giP8Kw',
        '3XfurMztLfwu4qkZf6bJc9q1FXUTu65zsjWivfcSKcYW',
        'BzufN4pbQXmJ6dQn2ZUKtkfA1vy7VyeodvjyAJPcDRgD',
        '93PoC6Atr18n4bY7ajfPHpe1SBrzDbYub8EPoTaLEZ8D',
        '2D67WPYJN7ZxVWnLwRjm2KEozs2aBjW2BTK4arJnDCeq',
        'BhdFgLMmEZCgqmhVvn8DhTwswg29y78EVZModmjfUhw4',
        '47APvEhPcL4cmCTTcTA2otctzeEc9fLwBvZXNJnesFH6',
        'C8GP5mxSmWJPp6hvuKRazSj3oLBGHZm5W7q25GBuipaU',
        'B8T6bpRskxU5tPxLF3kb3ydNuvZSiZr3H6NAaYuJCwoj',
        '8MidnMdciwbTiWxXcaQCqAsLL8qhgfHAcZUbd3aHm3XX',
        'HU3QvkMDtfEVHyZGkWLdT3VPtjvuCjcyJQSFDteeJWL4',
        'HQKQyKkwPQcPsH7M9c5XQJQ7uDXJCQPLheyxR8otSB39',
        'FkTpGs2nyRYRkfca5FHU6nyDa7G9wh8Lqys2M8YDy3X6',
        'By2mHm8LWGF76nfHKVJdBB25M2Rz76dr3KRYZoWhzWBt',
        '56WLxjs3HajAGzyUHbEdkWi57fvWcR5kgQzwLTVBchUd',
        '47ZZyG2s3kYsYHBEj7rbwrSHzWxQiLJ2QSmFfuSFhrvC',
        '7ZuQ6BfBhUSqfNyKsd7mhLJeHcZWAZjrDB9kyDZLGHwe',
        'GRGVhibnaTZkNbRbRZGNj8xYW7U5ttFANaTnSvDrmcTs',
        '9YqQDuMbmN5Wwu8USnu32Jgd2Pe8xxAGKE5dpEDnhXrZ',
        'GUASpAqMzVzerji94WLieC9nJyR4LunjK9djZuDC9MhM',
        'DkLJiEVUqKJJTwgu6SPAQ2AoHFuFbAf8ussUyCKwGu2P',
        '2BVbrsN2KwJ3WsUNcbqd81mMHEYUuqWWkqzHRo6XDJ4E',
        'AVGx3PknZjrce7RtkP6BcJ9XtJzpxV1JN6zDQrmhPNCK',
        '81eJb22B6fWHpg4YdMLH46WympZev7fD24twnsxnW4jd',
        '4yZ9kagevHeVcWddDAqKKCXjQpeVTjyJGtAgV16KdRLt',
        '5kF4huP3SsxvQMR4Y7JBRSvNCJwwPrdFuh8fH5Hzdzcp',
        '2E8fVZ7soAjG6FuG5Mf1h7LoJ1zxLKTDXgkSeASPD1sY',
        '45EXRq6YPQwHPj4uKBxipDMncEfMNbU6dHDZAM5bDJAe',
        'CMh2MBjGjeXe7J7ycSF3NCVP5ujDX4ZRCahcYrRCwTzD',
        '8DXF8uhKmXv8HuKciQyHcAAAdLqpY1gMCz5zupQBxZHS',
        '4dHY8Tny6MuxtsuYQaRzUgHXc2pAxHAAh9khDpQqp8Pz',
        '7JtsKtv1HTifheYJHGBads67MF1fb93a6znurdTtpEwh',
        '2DiKeVCzpQWogSvMMwwpL4K1yZWChTrVZcBatMxm44mf',
        'DjQC4k4anVbk2m3LMDe1ETMupVerBL9SCEomXUvMK6Lr',
        '2CmnZFgGGh1JWqX9kVteXUoXqm92M8YR6Yc8ptgN4efi',
        '4J254NABrePj45TAYeMFRxGX9GLJreRYF3guAE3y3Bmx',
        'BSvcYBpzTfGf7qCCSG9ayp94yn6eaxjSv89o6LHju6Pr',
        'Py92oX4V2jK6PpfqvyJ2epUbQyBvNyuWbyhkA3f56Hs',
        '7qVWcMCf3yKfZ6huPD4yUhDNELS8PfFyfp9fM5v3d7zR',
        '3MZ4L3aiuKQgLk3RivCjZix9CkzYkYCfiQBwdzwfCe3c',
        'dwLR4dcddu44D8Gus1KbqUayLxf1zUFf5QHJfPLp7e8',
        'D6frp2WZ1kBUD1VUppJscoxsPD9Bt24d5Zr9SRXHgVhR',
        'CyWWuLwyomTSMFBMZokXoV57cfucKnhQnLWMrQjyUCwr',
        '5CPn5hKy3FEzbsntoqP4pq4uoXyFQxJk85FHQ1jeDJJC',
        '8ekBBxxrXc63dvJBEqCL94gXeBGAydxjGrsrWyrR316o ',
        '41sL6y9h1KS64TSfL2VanicZsVgLCAd81suN59fY8fHA',
        '5CJyEdWravrnuSZnWTKhFFwvg7U6GBW19qP7hPyck9y2',
        '6mLodSv1UTRcYW2uTQ8mgnErn3VnMLyo8qrt7RTVTZMY',
        '0x88523560D1AEa6178c04eE547Df54E6DDbb405AE',
        'E98cUg3ZdL8ymYW2ck2WT3TfKVAzgk528JJtsW5GbcoW',
        'C3o3cYK7CfDj2rnnquqZraC1krPLCVjrvvSWHDEQ1q1K ',
        '9FJ8mkydxa3AfD144QMhhin876TKfx2VE7dyG2UYucYJ',
        '0x026fd2ddf47f066eB50a8c223519738714543690',
        '5EaSa2xvMRTiz2vaA4KPd4kTeafcpqz2nZnFBcQMwTMF ',
        '5wkfpqi8u3psaxw1CBfZB2Edue15G3AAcNkopDVWP9Wr',
        'Er3RbgBtthqjzbeQM6wRmLfoJrnsxG2ncevL9Y2J4oBd',
        '2BhsD2z9qAPbggDQJjCR2rKYbm7ayeEkBCBXZ54a2oT4',
        '3JkNMDZJ9sN4g8qTRRFAfhtDYq9rodVjp7fgzaB7YVKy',
        '0x9DAFE97fA20075016a420CF031f10f2b3Fe81a92',
        'CdxME44zYLzPLwFYZtCCuJV6mREBGAhPEm9SCZwmDqLB',
        'DfGtaan4GiLmBKPrQokrMhgtkydV1ASYL4UtbTHiRDTp',
        '4twz981qh1sTzSaT7NQKyjNaPcUDn5NXrMxeYdrfAXok',
        'A6o2rWh8kNeH3U1BVkwJmLProiNpEoqbctJqiXoDfU47',
        'GrkpgNM9YEXTiMN8vSR6J3urME6PJKqAxhPomga7JsLf',
        '2biBXLgjCshe3xptGmCuTvJ1jAycCamBeNqUa8enj6nS',
        'Cdt5ASX5Rp1YpzmBXnT8HJrpsF3QVLwVhRiRzWEdJvef',
        'Dk76KzkTEH2qUQNCkSYLpS3j3QuzBD3tqY5FLZuWGPcM',
        '44D91upS4ftFWGKuqXcfF7Re45SdgzqXTUSMe7TfVjBN',
        '5wN7oT47cu76NgcUKpPfcPcG3vv7YZSyqxLKLwNp95Pa',
        'Hhogwen1EbbdufAruT5CNBFvzeScZyFz38WeHzFPcfpk',
        '3nnMdxNiRr4RFGXM8jL55H25jpytmneDucqykU3G7uSY',
        'K4AQizQMCbvaMi3vAF65wsQNCioeqRiJQ616h9vFyPw',
        'FufTkwa74wVYZHWfLaYcEZW2kGC8jentf4RwSrjqhv8V',
        'CMcM1jEaEM9a7jrgf2AMX1qd4oNuh8FmqgvXD6PiKVwm',
        'BpLrG1Z8im2suXFNLzTCNYsw7M7zsq7tPWCoRJrtKFT5',
        '7XKm9G3uNZjtfcP3Btm7MCAo3kW53gdi5GiLWbtSxWxY',
        'HSLcfrDY8kQd5g4azNbzwADDMvioGhno278N4WMbEdSa',
        '3YCBpLupsTepiBEC1eRzMT45D7fZcqXg6H4vaKUareHt',
        'DhDD6bkTXGmo4q3vrf38M88unSs3auwUAAEY2V1oQx7X',
        'EFZU4W3NdWCEn674L6S4qFbEnFCfQWdkQT9rzxm8hfb8',
        'JDLAVvhzretVfzKAK5bAU9mhuZTo1Kzq9JfupwtSPjtW',
        '613ofMbPKZJTWYLA1Ubh1xPcPvpwfCZWmcBC1vpp8bQw',
        'DDMYYJrKLfZqfW3Mnz7Lb5bGUz5w9u5QufB7aYwmBYRY',
        '5Ws6RtLf4cTKPkasp8y5r8jrpkeJ8SVrcZ33Dr3DHqAo',
        '8Nf5rqBCx1bby179RGmo3XTB4PMoqmePna2KbjooFi2P',
        'FF1jeJMGXE2zKK9KDLuw3jnzrtNEvWWawkM5hYTPqbTR',
        '8fwLDBdT9DkhzJ7Q1aMtp4xRQLBeBSVXQWXxW6gxaNke',
        '9UUYbvKpvRwXpA3i3wMPTdP9ZkrcBKK9DPZ7eJKzj7w9',
        '6X8f9Lc4c6tbn5S4wokankeNuUBgEG95NyTKnNQQTmRg',
        '7EBBxChcw1qGDMVhcogif9xfHdh4bkG6eDeDViRiNtcE',
        '4Ve5mtDNxLsv2ZoFoXiLMZjRZG3SBbAsfD7f9AqkkuFF',
        '3ExZeXZPojYNV9rSpxHXTfEZp9mJjrZjbpaLeD3KWQsa',
        'GEdzK1k1PRDmAeVHU1TGESNh4jjMSKoUErcEebLrbpXa',
        'AmEqHtKqPUNybkNPb8MdkznovnDMqASZmia6AV6EtNge',
        'G89xwVGgnApFQXPKN5EpAa5b8GbNVqtYYzsBYJNPjwpv',
        'w9jvcFuafMPB5k3e8ZqbtF7CR3u4pXsz3ECS2gQiQkG',
        '3THckYf1V91SsL4MTqnQFQgkU6ogEgCrpBwWrqA6WDJq',
        'CqbpT6oo4Pioewp3CLDVY2rS7PRimac9zT5n1SbwwfAm',
        '8AkG5u9fuox6Jb3ZGPziKJF5hS92PbVXhQXXYN46o9VE',
        '0x56028b398B8761aaAFFe4a6cc61f4494c655c27b',
        '3qr1vXAR7XQiXgysxUDB4rXzj5UQ6KHAac2N9fGcL8FZ',
        '9NZNEqqe56WdoQEatY5dPtAMfu6egxTpc4jWpUnvoVkU',
        '9kmrGfZimm42dRiRfuy5U6CQfLY2Dw9R1m6NP8ngxSLd',
        'GNp5xewjDD7Cshan5mMCFUVPkxZfB72QgXebc6BPXY4U',
        'BiHhSaRfpKS7EgXeTUPw55pSgLZvoRvzgYM9RqjCoUAS']


      const WL_DATE = Date.parse('08 Jan 2022 02:30:00 UTC');

      const LAUNCH_DATE = Date.parse('08 Jan 2022 03:00:00 UTC');
    
        const dateInPast = (firstDate: Number) => {
          let today = new Date();
      
          if (firstDate <= today.getTime()) {
            return true;
          }
      
          return false;
        };

        const checkInWL = (addy: string | undefined) => {
          if (addy !== undefined) {
            console.log(addy);
            return WL.includes(addy);
          }
          return false;
        };

      const whitelisted = checkInWL(wallet.publicKey?.toBase58());
      console.log("whitelisted " + whitelisted);
  
      const whiteListStarted = dateInPast(WL_DATE);
      console.log("whitelisted sale started " + whiteListStarted);
  
      const publicStarted = dateInPast(LAUNCH_DATE);
      console.log("public sale started " + publicStarted)
  
      const canMint = (whitelisted && whiteListStarted) || publicStarted;
  
      if (canMint) {
        setIsDisabled(false);
      }

      try {
        const balance = await props.connection.getBalance(
          anchorWallet.publicKey,
        );
        setYourSOLBalance(balance);

        if (props.fairLaunchId) {
          const state = await getFairLaunchState(
            anchorWallet,
            props.fairLaunchId,
            props.connection,
          );

          setFairLaunch(state);

          try {
            if (state.state.tokenMint) {
              const fairLaunchBalance =
                await props.connection.getTokenAccountBalance(
                  (
                    await getAtaForMint(
                      state.state.tokenMint,
                      anchorWallet.publicKey,
                    )
                  )[0],
                );

              if (fairLaunchBalance.value) {
                setFairLaunchBalance(fairLaunchBalance.value.uiAmount || 0);
              }
            }
          } catch (e) {
            console.log('Problem getting fair launch token balance');
            console.log(e);
          }
          if (contributed === 0) {
            const phase = getPhase(state, undefined);

            if (phase === Phase.SetPrice) {
              const ticks =
                (state.state.data.priceRangeEnd.toNumber() -
                  state.state.data.priceRangeStart.toNumber()) /
                state.state.data.tickSize.toNumber();
              const randomTick = Math.round(Math.random() * ticks);

              setContributed(
                (state.state.data.priceRangeStart.toNumber() +
                  randomTick * state.state.data.tickSize.toNumber()) /
                  LAMPORTS_PER_SOL,
              );
            } else {
              setContributed(
                (
                  state.state.currentMedian || state.state.data.priceRangeStart
                ).toNumber() / LAMPORTS_PER_SOL,
              );
            }
          }
        } else {
          console.log('No fair launch detected in configuration.');
        }
      } catch (e) {
        console.log('Problem getting fair launch state');
        console.log(e);
      }
      if (props.candyMachineId) {
        try {
          const cndy = await getCandyMachineState(
            anchorWallet,
            props.candyMachineId,
            props.connection,
          );
          setCandyMachine(cndy);
        } catch (e) {
          console.log('Problem getting candy machine state');
          console.log(e);
        }
      } else {
        console.log('No candy machine detected in configuration.');
      }
    })();
  }, [
    anchorWallet,
    props.candyMachineId,
    props.connection,
    props.fairLaunchId,
    contributed,
    wallet.publicKey
  ]);

  const min = formatNumber.asNumber(fairLaunch?.state.data.priceRangeStart);
  const max = formatNumber.asNumber(fairLaunch?.state.data.priceRangeEnd);
  const step = formatNumber.asNumber(fairLaunch?.state.data.tickSize);
  const median = formatNumber.asNumber(fairLaunch?.state.currentMedian);
  const phase = getPhase(fairLaunch, candyMachine);
  console.log('Phase', phase);
  const marks = [
    {
      value: min || 0,
      label: `${min} SOL`,
    },
    // TODO:L
    ...(phase === Phase.SetPrice
      ? []
      : [
          {
            value: median || 0,
            label: `${median}`,
          },
        ]),
    // display user comitted value
    // {
    //   value: 37,
    //   label: '37°C',
    // },
    {
      value: max || 0,
      label: `${max} SOL`,
    },
  ].filter(_ => _ !== undefined && _.value !== 0) as any;

  const onDeposit = async () => {
    if (!anchorWallet) {
      return;
    }

    console.log('deposit');
    setIsMinting(true);
    try {
      await purchaseTicket(contributed, anchorWallet, fairLaunch);
      setIsMinting(false);
      setAlertState({
        open: true,
        message: `Congratulations! Bid ${
          fairLaunch?.ticket.data ? 'updated' : 'inserted'
        }!`,
        severity: 'success',
      });
    } catch (e) {
      console.log(e);
      setIsMinting(false);
      setAlertState({
        open: true,
        message: 'Something went wrong.',
        severity: 'error',
      });
    }
  };
  const onRefundTicket = async () => {
    if (!anchorWallet) {
      return;
    }

    console.log('refund');
    try {
      setIsMinting(true);
      await purchaseTicket(0, anchorWallet, fairLaunch);
      setIsMinting(false);
      setAlertState({
        open: true,
        message:
          'Congratulations! Funds withdrawn. This is an irreversible action.',
        severity: 'success',
      });
    } catch (e) {
      console.log(e);
      setIsMinting(false);
      setAlertState({
        open: true,
        message: 'Something went wrong.',
        severity: 'error',
      });
    }
  };

  const onPunchTicket = async () => {
    if (!anchorWallet || !fairLaunch || !fairLaunch.ticket) {
      return;
    }

    console.log('punch');
    setIsMinting(true);
    try {
      await punchTicket(anchorWallet, fairLaunch);
      setIsMinting(false);
      setAlertState({
        open: true,
        message: 'Congratulations! Ticket punched!',
        severity: 'success',
      });
    } catch (e) {
      console.log(e);
      setIsMinting(false);
      setAlertState({
        open: true,
        message: 'Something went wrong.',
        severity: 'error',
      });
    }
  };

  const candyMachinePredatesFairLaunch =
    candyMachine?.state.goLiveDate &&
    fairLaunch?.state.data.phaseTwoEnd &&
    candyMachine?.state.goLiveDate.lt(fairLaunch?.state.data.phaseTwoEnd);

  const notEnoughSOL = !!(
    yourSOLBalance != null &&
    fairLaunch?.state.data.priceRangeStart &&
    fairLaunch?.state.data.fee &&
    yourSOLBalance + (fairLaunch?.ticket?.data?.amount.toNumber() || 0) <
      contributed * LAMPORTS_PER_SOL +
        fairLaunch?.state.data.fee.toNumber() +
        0.01
  );

  return (
    <Container style={{ marginTop: 100 }}>
      {fairLaunch && (
        <AntiRug
          fairLaunch={fairLaunch}
          isMinting={[isMinting, setIsMinting]}
          setAlertState={setAlertState}
        />
      )}
      <Container maxWidth="xs" style={{ position: 'relative' }}>
        <Paper
          style={{ padding: 24, backgroundColor: '#151A1F', borderRadius: 6 }}
        >
          <img src={Gif} alt="gif"/>
          <Grid container justifyContent="center" direction="column">
            <PhaseHeader
              phase={phase}
              fairLaunch={fairLaunch}
              candyMachine={candyMachine}
              rpcUrl={rpcUrl}
              candyMachinePredatesFairLaunch={!!candyMachinePredatesFairLaunch}
            />
            {fairLaunch && (
              <Grid
                container
                direction="column"
                justifyContent="center"
                alignItems="center"
                style={{
                  height: 200,
                  marginTop: 20,
                  marginBottom: 20,
                  background: '#384457',
                  borderRadius: 6,
                }}
              >
                {fairLaunch.ticket.data ? (
                  <>
                    <Typography>Your bid</Typography>
                    <Typography variant="h6" style={{ fontWeight: 900 }}>
                      {formatNumber.format(
                        (fairLaunch?.ticket.data?.amount.toNumber() || 0) /
                          LAMPORTS_PER_SOL,
                      )}{' '}
                      SOL
                    </Typography>
                  </>
                ) : [Phase.AnticipationPhase, Phase.SetPrice].includes(
                    phase,
                  ) ? (
                  <Typography>
                    You haven't entered this raffle yet. <br />
                    {fairLaunch?.state?.data?.fee && (
                      <span>
                        <b>
                          All initial bids will incur a ◎{' '}
                          {fairLaunch?.state?.data?.fee.toNumber() /
                            LAMPORTS_PER_SOL}{' '}
                          fee.
                        </b>
                      </span>
                    )}
                  </Typography>
                ) : (
                  <Typography>
                    You didn't participate in this raffle.
                  </Typography>
                )}
              </Grid>
            )}

            {fairLaunch && (
              <>
                {[
                  Phase.SetPrice,
                  Phase.GracePeriod,
                  Phase.RaffleFinished,
                  Phase.Lottery,
                ].includes(phase) &&
                  fairLaunch?.ticket?.data?.state.withdrawn && (
                    <div style={{ paddingTop: '15px' }}>
                      <Alert severity="error">
                        Your bid was withdrawn and cannot be adjusted or
                        re-inserted.
                      </Alert>
                    </div>
                  )}
                {[Phase.GracePeriod].includes(phase) &&
                  fairLaunch.state.currentMedian &&
                  fairLaunch?.ticket?.data?.amount &&
                  !fairLaunch?.ticket?.data?.state.withdrawn &&
                  fairLaunch.state.currentMedian.gt(
                    fairLaunch?.ticket?.data?.amount,
                  ) && (
                    <div style={{ paddingTop: '15px' }}>
                      <Alert severity="warning">
                        Your bid is currently below the median and will not be
                        eligible for the raffle.
                      </Alert>
                    </div>
                  )}
                {[Phase.RaffleFinished, Phase.Lottery].includes(phase) &&
                  fairLaunch.state.currentMedian &&
                  fairLaunch?.ticket?.data?.amount &&
                  !fairLaunch?.ticket?.data?.state.withdrawn &&
                  fairLaunch.state.currentMedian.gt(
                    fairLaunch?.ticket?.data?.amount,
                  ) && (
                    <div style={{ paddingTop: '15px' }}>
                      <Alert severity="error">
                        Your bid was below the median and was not included in
                        the raffle. You may click <em>Withdraw</em> when the
                        raffle ends or you will be automatically issued one when
                        the Fair Launch authority withdraws from the treasury.
                      </Alert>
                    </div>
                  )}
                {notEnoughSOL && (
                  <Alert severity="error">
                    You do not have enough SOL in your account to place this
                    bid.
                  </Alert>
                )}
              </>
            )}

            {[Phase.SetPrice, Phase.GracePeriod].includes(phase) && (
              <>
                <Grid style={{ marginTop: 40, marginBottom: 20 }}>
                  {contributed > 0 ? (
                    <ValueSlider
                      min={min}
                      marks={marks}
                      max={max}
                      step={step}
                      value={contributed}
                      onChange={(ev, val) => setContributed(val as any)}
                      valueLabelDisplay="auto"
                      style={{
                        width: 'calc(100% - 40px)',
                        marginLeft: 20,
                        height: 30,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <CircularProgress />
                    </div>
                  )}
                </Grid>
              </>
            )}

            {!wallet.connected ? (
              <ConnectButton>
                Connect{' '}
                {[Phase.SetPrice].includes(phase) ? 'to bid' : 'to see status'}
              </ConnectButton>
            ) : (
              <div>
                {[Phase.SetPrice, Phase.GracePeriod].includes(phase) && (
                  <>
                    <CTAButton
                      onClick={onDeposit}
                      variant="contained"
                      disabled={
                        isMinting ||
                        (!fairLaunch?.ticket.data &&
                          phase === Phase.GracePeriod) ||
                        notEnoughSOL
                      }
                    >
                      {isMinting ? (
                        <CircularProgress />
                      ) : !fairLaunch?.ticket.data ? (
                        'Place bid'
                      ) : (
                        'Change bid'
                      )}
                      {}
                    </CTAButton>
                  </>
                )}

                {[Phase.RaffleFinished].includes(phase) && (
                  <>
                    {isWinner(fairLaunch) && (
                      <CTAButton
                        onClick={onPunchTicket}
                        variant="contained"
                        disabled={
                          fairLaunch?.ticket.data?.state.punched !== undefined
                        }
                      >
                        {isMinting ? <CircularProgress /> : 'Punch Ticket'}
                      </CTAButton>
                    )}

                    {!isWinner(fairLaunch) && (
                      <CTAButton
                        onClick={onRefundTicket}
                        variant="contained"
                        disabled={
                          isMinting ||
                          fairLaunch?.ticket.data === undefined ||
                          fairLaunch?.ticket.data?.state.withdrawn !== undefined
                        }
                      >
                        {isMinting ? <CircularProgress /> : 'Withdraw'}
                      </CTAButton>
                    )}
                  </>
                )}

                {phase === Phase.Phase4 && (
                  <>
                    {(!fairLaunch ||
                      isWinner(fairLaunch) ||
                      fairLaunchBalance > 0) && (
                      <MintContainer>
                        {candyMachine?.state.isActive &&
                        candyMachine?.state.gatekeeper &&
                        wallet.publicKey &&
                        wallet.signTransaction ? (
                          <GatewayProvider
                            wallet={{
                              publicKey:
                                wallet.publicKey ||
                                new PublicKey(CANDY_MACHINE_PROGRAM),
                              //@ts-ignore
                              signTransaction: wallet.signTransaction,
                            }}
                            // // Replace with following when added
                            // gatekeeperNetwork={candyMachine.state.gatekeeper_network}
                            gatekeeperNetwork={
                              candyMachine?.state?.gatekeeper?.gatekeeperNetwork
                            } // This is the ignite (captcha) network
                            /// Don't need this for mainnet
                            clusterUrl={rpcUrl}
                            options={{ autoShowModal: false }}
                          >
                            <MintButton
                              candyMachine={candyMachine}
                              fairLaunch={fairLaunch}
                              isMinting={isMinting}
                              isDisabled={isDisabled}
                              fairLaunchBalance={fairLaunchBalance}
                              onMint={onMint}
                            />
                            <h4>Bears Remaining / Total Supply </h4>
                            <h4>{candyMachine?.state.itemsRemaining} / {candyMachine?.state.itemsAvailable}</h4>
                          </GatewayProvider>
                        ) : (
                          <div>
                          <MintButton
                          candyMachine={candyMachine}
                          fairLaunch={fairLaunch}
                          isMinting={isMinting}
                          isDisabled={isDisabled}
                          fairLaunchBalance={fairLaunchBalance}
                          onMint={onMint}
                          />
                          <h1>{candyMachine?.state.itemsRemaining}/{candyMachine?.state.itemsAvailable}</h1>
                          </div>
                        )}
                      </MintContainer>
                    )}

                    {!(
                      !fairLaunch ||
                      isWinner(fairLaunch) ||
                      fairLaunchBalance > 0
                    ) && (
                      <CTAButton
                        onClick={onRefundTicket}
                        variant="contained"
                        disabled={
                          isMinting ||
                          fairLaunch?.ticket.data === undefined ||
                          fairLaunch?.ticket.data?.state.withdrawn !== undefined
                        }
                      >
                        {isMinting ? <CircularProgress /> : 'Withdraw'}
                      </CTAButton>
                    )}
                  </>
                )}
              </div>
            )}

            <Grid
              container
              justifyContent="space-between"
              color="textSecondary"
            >
              {fairLaunch && (
                <Link
                  component="button"
                  variant="body2"
                  color="textSecondary"
                  align="left"
                  onClick={() => {
                    setHowToOpen(true);
                  }}
                >
                  How this raffle works
                </Link>
              )}
              {fairLaunch?.ticket.data && (
                <Link
                  component="button"
                  variant="body2"
                  color="textSecondary"
                  align="right"
                  onClick={() => {
                    if (
                      !fairLaunch ||
                      phase === Phase.Lottery ||
                      isWinner(fairLaunch) ||
                      fairLaunchBalance > 0
                    ) {
                      setRefundExplainerOpen(true);
                    } else {
                      onRefundTicket();
                    }
                  }}
                >
                  Withdraw funds
                </Link>
              )}
            </Grid>
            <Dialog
              open={refundExplainerOpen}
              onClose={() => setRefundExplainerOpen(false)}
              PaperProps={{
                style: { backgroundColor: '#222933', borderRadius: 6 },
              }}
            >
              <MuiDialogContent style={{ padding: 24 }}>
                During raffle phases, or if you are a winner, or if this website
                is not configured to be a fair launch but simply a candy
                machine, refunds are disallowed.
              </MuiDialogContent>
            </Dialog>
            <Dialog
              open={howToOpen}
              onClose={() => setHowToOpen(false)}
              PaperProps={{
                style: { backgroundColor: '#222933', borderRadius: 6 },
              }}
            >
              <MuiDialogTitle
                disableTypography
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Link
                  component="button"
                  variant="h6"
                  color="textSecondary"
                  onClick={() => {
                    setHowToOpen(true);
                  }}
                >
                  How it works
                </Link>
                <IconButton
                  aria-label="close"
                  className={dialogStyles.closeButton}
                  onClick={() => setHowToOpen(false)}
                >
                  <CloseIcon />
                </IconButton>
              </MuiDialogTitle>
              <MuiDialogContent>
                <Typography variant="h6">
                  Phase 1 - Set the fair price:
                </Typography>
                <Typography gutterBottom color="textSecondary">
                  Enter a bid in the range provided by the artist. The median of
                  all bids will be the "fair" price of the raffle ticket.{' '}
                  {fairLaunch?.state?.data?.fee && (
                    <span>
                      <b>
                        All bids will incur a ◎{' '}
                        {fairLaunch?.state?.data?.fee.toNumber() /
                          LAMPORTS_PER_SOL}{' '}
                        fee.
                      </b>
                    </span>
                  )}
                </Typography>
                <Typography variant="h6">Phase 2 - Grace period:</Typography>
                <Typography gutterBottom color="textSecondary">
                  If your bid was at or above the fair price, you automatically
                  get a raffle ticket at that price. There's nothing else you
                  need to do. Your excess SOL will be returned to you when the
                  Fair Launch authority withdraws from the treasury. If your bid
                  is below the median price, you can still opt in at the fair
                  price during this phase.
                </Typography>
                {candyMachinePredatesFairLaunch ? (
                  <>
                    <Typography variant="h6">
                      Phase 3 - The Candy Machine:
                    </Typography>
                    <Typography gutterBottom color="textSecondary">
                      Everyone who got a raffle ticket at the fair price is
                      entered to win an NFT. If you win an NFT, congrats. If you
                      don’t, no worries, your SOL will go right back into your
                      wallet.
                    </Typography>
                  </>
                ) : (
                  <>
                    <Typography variant="h6">Phase 3 - The Lottery:</Typography>
                    <Typography gutterBottom color="textSecondary">
                      Everyone who got a raffle ticket at the fair price is
                      entered to win a Fair Launch Token that entitles them to
                      an NFT at a later date using a Candy Machine here. If you
                      don’t win, no worries, your SOL will go right back into
                      your wallet.
                    </Typography>
                    <Typography variant="h6">
                      Phase 4 - The Candy Machine:
                    </Typography>
                    <Typography gutterBottom color="textSecondary">
                      On{' '}
                      {candyMachine?.state.goLiveDate
                        ? toDate(
                            candyMachine?.state.goLiveDate,
                          )?.toLocaleString()
                        : ' some later date'}
                      , you will be able to exchange your Fair Launch token for
                      an NFT using the Candy Machine at this site by pressing
                      the Mint Button.
                    </Typography>
                  </>
                )}
              </MuiDialogContent>
            </Dialog>

            {/* {wallet.connected && (
              <p>
                Address: {shortenAddress(wallet.publicKey?.toBase58() || '')}
              </p>
            )}

            {wallet.connected && (
              <p>Balance: {(balance || 0).toLocaleString()} SOL</p>
            )} */}
          </Grid>
        </Paper>
      </Container>

      {fairLaunch && (
        <Container
          maxWidth="xs"
          style={{ position: 'relative', marginTop: 10 }}
        >
          <div style={{ margin: 20 }}>
            <Grid container direction="row" wrap="nowrap">
              <Grid container md={4} direction="column">
                <Typography variant="body2" color="textSecondary">
                  Bids
                </Typography>
                <Typography
                  variant="h6"
                  color="textPrimary"
                  style={{ fontWeight: 'bold' }}
                >
                  {fairLaunch?.state.numberTicketsSold.toNumber() || 0}
                </Typography>
              </Grid>
              <Grid container md={4} direction="column">
                <Typography variant="body2" color="textSecondary">
                  Median bid
                </Typography>
                <Typography
                  variant="h6"
                  color="textPrimary"
                  style={{ fontWeight: 'bold' }}
                >
                  ◎{' '}
                  {phase === Phase.AnticipationPhase || phase === Phase.SetPrice
                    ? '???'
                    : formatNumber.format(median)}
                </Typography>
              </Grid>
              <Grid container md={4} direction="column">
                <Typography variant="body2" color="textSecondary">
                  Total raised
                </Typography>
                <Typography
                  variant="h6"
                  color="textPrimary"
                  style={{ fontWeight: 'bold' }}
                >
                  ◎{' '}
                  {formatNumber.format(
                    (fairLaunch?.treasury || 0) / LAMPORTS_PER_SOL,
                  )}
                </Typography>
              </Grid>
            </Grid>
          </div>
        </Container>
      )}
      <Snackbar
        open={alertState.open}
        autoHideDuration={6000}
        onClose={() => setAlertState({ ...alertState, open: false })}
      >
        <Alert
          onClose={() => setAlertState({ ...alertState, open: false })}
          severity={alertState.severity}
        >
          {alertState.message}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default Home;
